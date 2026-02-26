"""
JOI Voice Agent — Python LiveKit worker.

Bridges LiveKit's voice pipeline to the JOI gateway's /api/voice/chat SSE endpoint.
STT (Deepgram) and TTS (Cartesia) connect directly with their own API keys.
The LLM call is delegated to the gateway which runs runAgent() with full tool/memory support.
"""

import json
import os
import re
import logging
import array
import asyncio
import time
import hashlib
from collections import OrderedDict
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterable, Any, Protocol

import aiohttp
from dotenv import load_dotenv
try:
    from redis.asyncio import Redis as AsyncRedis
except Exception:  # pragma: no cover - optional dependency
    AsyncRedis = None

from livekit import agents, rtc
from livekit.agents import (
    AgentServer,
    AgentSession,
    Agent,
    ModelSettings,
    llm,
    tokenize,
    tts as lk_tts,
    utils as lk_utils,
    APIConnectOptions,
)
from livekit.agents.types import DEFAULT_API_CONNECT_OPTIONS, NOT_GIVEN, NotGivenOr
from livekit.plugins import deepgram, cartesia


class _StubLLM(llm.LLM):
    """No-op LLM stub — passes the `self.llm is None` guard in AgentActivity.
    Never actually called because JOIAgent overrides llm_node entirely."""

    def chat(self, **kwargs):
        raise NotImplementedError("StubLLM.chat should never be called")


class DebugDeepgramSTT(deepgram.STT):
    """Deepgram STT wrapper with lightweight runtime probes for diagnostics."""

    def stream(self, **kwargs):
        stream = super().stream(**kwargs)

        # Probe inbound PCM levels (without consuming the stream).
        frame_probe = {"count": 0}
        orig_push_frame = stream.push_frame

        def push_frame_with_probe(frame):
            frame_probe["count"] += 1
            n = frame_probe["count"]
            if n <= 10 or n % 200 == 0:
                try:
                    pcm = frame.data.tobytes()
                    samples = array.array("h")
                    samples.frombytes(pcm)
                    if samples:
                        step = max(1, len(samples) // 200)
                        sampled = samples[::step]
                        peak = max(abs(v) for v in sampled)
                        avg = sum(abs(v) for v in sampled) / len(sampled)
                        logger.info(
                            f"AudioProbe frame={n} peak={peak} avg={avg:.1f} "
                            f"sr={frame.sample_rate} ch={frame.num_channels}"
                        )
                except Exception as e:
                    logger.warning(f"AudioProbe frame={n} failed: {e}")
            return orig_push_frame(frame)

        stream.push_frame = push_frame_with_probe

        # Probe Deepgram events to see if transcripts are empty or missing.
        orig_process = stream._process_stream_event

        def process_with_probe(data: dict):
            try:
                typ = data.get("type")
                if typ == "SpeechStarted":
                    logger.info("Deepgram event: SpeechStarted")
                elif typ == "Results":
                    alt = (data.get("channel", {}).get("alternatives") or [{}])[0]
                    text = alt.get("transcript", "")
                    logger.info(
                        "Deepgram Results: "
                        f"final={data.get('is_final')}, "
                        f"endpoint={data.get('speech_final')}, "
                        f"text_len={len(text)}, "
                        f"text={text[:120]!r}"
                    )
            except Exception:
                pass
            return orig_process(data)

        stream._process_stream_event = process_with_probe
        return stream

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("joi-voice")
VOICE_MARKER_RE = re.compile(r"\[(?:[a-z][a-z0-9_-]{0,20})\]\s*", re.IGNORECASE)

# ── Config ──

def load_joi_config() -> dict:
    """Load ~/.joi/config.json"""
    config_path = Path.home() / ".joi" / "config.json"
    if not config_path.exists():
        logger.warning(f"Config not found at {config_path}, using defaults")
        return {}
    with open(config_path) as f:
        return json.load(f)


CONFIG = load_joi_config()
LK_CONFIG = CONFIG.get("livekit", {})


def _env_int(name: str, default: int, *, minimum: int | None = None) -> int:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        value = default
    else:
        try:
            value = int(raw)
        except ValueError:
            logger.warning(f"Invalid int for {name}={raw!r}; using {default}")
            value = default
    if minimum is not None:
        value = max(minimum, value)
    return value


def _cfg_str(key: str, env: str, default: str) -> str:
    val = LK_CONFIG.get(key)
    if isinstance(val, str) and val.strip():
        return val.strip()
    env_val = os.environ.get(env)
    if env_val and env_val.strip():
        return env_val.strip()
    return default


def _cfg_bool(key: str, env: str, default: bool) -> bool:
    val = LK_CONFIG.get(key)
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        v = val.strip().lower()
        if v in {"1", "true", "yes", "on"}:
            return True
        if v in {"0", "false", "no", "off"}:
            return False
    env_val = os.environ.get(env)
    if env_val is None:
        return default
    return env_val.strip().lower() not in {"0", "false", "no", "off"}


def _cfg_int(key: str, env: str, default: int, *, minimum: int | None = None) -> int:
    val = LK_CONFIG.get(key)
    parsed = None
    if isinstance(val, int):
        parsed = val
    elif isinstance(val, float) and float(val).is_integer():
        parsed = int(val)
    elif isinstance(val, str):
        try:
            parsed = int(val.strip())
        except Exception:
            parsed = None
    if parsed is None:
        parsed = _env_int(env, default, minimum=minimum)
    elif minimum is not None:
        parsed = max(minimum, parsed)
    return parsed


def _cfg_float(key: str, env: str, default: float, *, minimum: float | None = None) -> float:
    val = LK_CONFIG.get(key)
    parsed: float | None = None
    if isinstance(val, (int, float)):
        parsed = float(val)
    elif isinstance(val, str):
        try:
            parsed = float(val.strip())
        except Exception:
            parsed = None
    if parsed is None:
        raw = os.environ.get(env)
        if raw is not None and raw.strip():
            try:
                parsed = float(raw)
            except Exception:
                parsed = None
    if parsed is None:
        parsed = default
    if minimum is not None:
        parsed = max(minimum, parsed)
    return parsed


GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:3100")
VOICE_CHAT_MAX_ATTEMPTS = 3
VOICE_CHAT_CONNECT_TIMEOUT_S = 6
VOICE_CHAT_READ_TIMEOUT_S = 90
VOICE_MIN_ENDPOINT_DELAY_S = _cfg_float("voiceMinEndpointSec", "JOI_VOICE_MIN_ENDPOINT_SEC", 0.15, minimum=0.0)
VOICE_MAX_ENDPOINT_DELAY_S = _cfg_float("voiceMaxEndpointSec", "JOI_VOICE_MAX_ENDPOINT_SEC", 0.8, minimum=0.0)
TTS_CACHE_ENABLED = _cfg_bool("ttsCacheEnabled", "JOI_TTS_CACHE_ENABLED", True)
TTS_CACHE_LOCAL_MAX_ITEMS = _cfg_int("ttsCacheLocalMaxItems", "JOI_TTS_CACHE_LOCAL_MAX_ITEMS", 512, minimum=0)
TTS_CACHE_LOCAL_MAX_BYTES = _cfg_int(
    "ttsCacheLocalMaxBytes",
    "JOI_TTS_CACHE_LOCAL_MAX_BYTES",
    64 * 1024 * 1024,
    minimum=1 * 1024 * 1024,
)
TTS_CACHE_MAX_TEXT_CHARS = _cfg_int("ttsCacheMaxTextChars", "JOI_TTS_CACHE_MAX_TEXT_CHARS", 280, minimum=32)
TTS_CACHE_MAX_AUDIO_BYTES = _cfg_int(
    "ttsCacheMaxAudioBytes",
    "JOI_TTS_CACHE_MAX_AUDIO_BYTES",
    2 * 1024 * 1024,
    minimum=16384,
)
TTS_CACHE_REDIS_TTL_SEC = _cfg_int(
    "ttsCacheRedisTtlSec",
    "JOI_TTS_CACHE_REDIS_TTL_SEC",
    604800,
    minimum=60,
)
TTS_CACHE_PREFIX = _cfg_str("ttsCachePrefix", "JOI_TTS_CACHE_PREFIX", "joi:tts:v1")
TTS_CACHE_REDIS_URL = _cfg_str("ttsCacheRedisUrl", "JOI_TTS_CACHE_REDIS_URL", "")

# ── Pronunciation replacement (ported from joi-agent.ts) ──

def build_pronunciation_replacer(rules: list[dict]):
    """Streaming-safe pronunciation replacer that buffers until word boundaries."""
    if not rules:
        return lambda text: text, lambda: ""

    patterns = []
    for r in rules:
        word = re.escape(r["word"])
        patterns.append((re.compile(rf"\b{word}\b", re.IGNORECASE), r["replacement"]))

    buffer = []

    def push(delta: str) -> str:
        buffer.append(delta)
        text = "".join(buffer)

        # Find last word boundary
        last_boundary = -1
        for i in range(len(text) - 1, -1, -1):
            if text[i] in " \n\t.,!?;:)]}":
                last_boundary = i
                break

        if last_boundary < 0:
            return ""

        to_flush = text[:last_boundary + 1]
        buffer.clear()
        buffer.append(text[last_boundary + 1:])

        for pattern, replacement in patterns:
            to_flush = pattern.sub(replacement, to_flush)
        return to_flush

    def flush() -> str:
        if not buffer:
            return ""
        text = "".join(buffer)
        buffer.clear()
        for pattern, replacement in patterns:
            text = pattern.sub(replacement, text)
        return text

    return push, flush


def strip_voice_markers(text: str) -> str:
    """Remove bracketed stage/emotion markers (e.g. [happy], [thinking])."""
    return VOICE_MARKER_RE.sub("", text)


def build_voice_prompt(lk_config: dict) -> str:
    """Build voice-mode system prompt suffix."""
    parts = []

    voice_prompt = lk_config.get("voicePrompt", "")
    if voice_prompt:
        parts.append(voice_prompt)

    rules = lk_config.get("pronunciations", [])
    if rules:
        guides = "\n".join(f'- "{r["word"]}" → write as "{r["replacement"]}"' for r in rules)
        parts.append(
            "## Pronunciation Guide\n"
            "When speaking, use these exact spellings so the text-to-speech engine pronounces them correctly:\n"
            + guides
        )

    parts.append(
        "## Voice Style\n"
        "Speak naturally and clearly. Never output bracketed markers like [happy] or [thinking]. "
        "Avoid repetitive time-based greetings and avoid repeatedly saying the user's name."
    )

    return "\n\n".join(parts)


# ── TTS cache (local LRU + Redis) ──

def _normalize_cache_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _build_tts_cache_key(*, text: str, fingerprint: dict[str, Any]) -> str:
    payload = {
        "text": _normalize_cache_text(text),
        "fp": fingerprint,
    }
    digest = hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=True).encode("utf-8")
    ).hexdigest()
    return f"{TTS_CACHE_PREFIX}:{digest}"


@dataclass(slots=True)
class CacheHit:
    pcm: bytes
    source: str


@dataclass(slots=True)
class VoiceCacheTurnMetrics:
    segments: int = 0
    cache_hits: int = 0
    cache_misses: int = 0
    cache_hit_chars: int = 0
    cache_miss_chars: int = 0
    cache_hit_audio_bytes: int = 0
    cache_miss_audio_bytes: int = 0

    def has_data(self) -> bool:
        return (self.cache_hits + self.cache_misses) > 0


class LocalAudioCache:
    def __init__(self, max_items: int, max_bytes: int) -> None:
        self._max_items = max_items
        self._max_bytes = max_bytes
        self._current_bytes = 0
        self._items: OrderedDict[str, bytes] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> bytes | None:
        if self._max_items <= 0:
            return None
        async with self._lock:
            pcm = self._items.get(key)
            if pcm is None:
                return None
            self._items.move_to_end(key)
            return pcm

    async def set(self, key: str, pcm: bytes) -> None:
        if self._max_items <= 0:
            return
        if len(pcm) > self._max_bytes:
            return
        async with self._lock:
            old = self._items.get(key)
            if old is not None:
                self._current_bytes -= len(old)

            self._items[key] = pcm
            self._current_bytes += len(pcm)
            self._items.move_to_end(key)
            while len(self._items) > self._max_items or self._current_bytes > self._max_bytes:
                _, evicted = self._items.popitem(last=False)
                self._current_bytes -= len(evicted)


class RemoteAudioCache(Protocol):
    name: str

    @property
    def enabled(self) -> bool:
        ...

    async def get(self, key: str) -> bytes | None:
        ...

    async def set(self, key: str, pcm: bytes) -> None:
        ...


class RedisAudioCache:
    name = "redis"

    def __init__(
        self,
        *,
        redis_url: str,
        ttl_sec: int,
        max_audio_bytes: int,
    ) -> None:
        self._redis_url = redis_url.strip()
        self._ttl_sec = ttl_sec
        self._max_audio_bytes = max_audio_bytes
        self._client: Any | None = None
        self._available = bool(self._redis_url and AsyncRedis is not None)
        if self._redis_url and AsyncRedis is None:
            logger.warning("redis package not installed; redis remote cache disabled")

    @property
    def enabled(self) -> bool:
        return self._available

    def _ensure_client(self) -> Any | None:
        if not self.enabled:
            return None
        if self._client is None:
            try:
                self._client = AsyncRedis.from_url(
                    self._redis_url,
                    socket_connect_timeout=0.3,
                    socket_timeout=0.5,
                    retry_on_timeout=False,
                    decode_responses=False,
                )
            except Exception as e:
                logger.warning(f"Failed creating Redis cache client: {type(e).__name__}: {e}")
                self._available = False
                return None
        return self._client

    async def get(self, key: str) -> bytes | None:
        client = self._ensure_client()
        if client is None:
            return None
        try:
            raw = await client.get(key)
            if raw is None:
                return None
            if isinstance(raw, str):
                pcm = raw.encode("latin1")
            elif isinstance(raw, (bytes, bytearray, memoryview)):
                pcm = bytes(raw)
            else:
                return None
            if len(pcm) > self._max_audio_bytes:
                logger.warning(
                    f"Redis cached payload too large ({len(pcm)} bytes), ignoring key={key[:24]}..."
                )
                return None
            return pcm
        except Exception as e:
            logger.debug(f"Redis cache get failed: {type(e).__name__}: {e}")
            return None

    async def set(self, key: str, pcm: bytes) -> None:
        if len(pcm) > self._max_audio_bytes:
            return
        client = self._ensure_client()
        if client is None:
            return
        try:
            await client.set(key, pcm, ex=self._ttl_sec)
        except Exception as e:
            logger.debug(f"Redis cache set failed: {type(e).__name__}: {e}")


class RemoteChainAudioCache:
    name = "remote-chain"

    def __init__(self, remotes: list[RemoteAudioCache]) -> None:
        self._remotes = [r for r in remotes if r.enabled]

    @property
    def enabled(self) -> bool:
        return len(self._remotes) > 0

    @property
    def backends(self) -> list[str]:
        return [r.name for r in self._remotes]

    async def get(self, key: str) -> CacheHit | None:
        for idx, remote in enumerate(self._remotes):
            pcm = await remote.get(key)
            if pcm is None:
                continue
            # Backfill higher-priority remotes if this was found deeper in chain.
            for backfill in self._remotes[:idx]:
                await backfill.set(key, pcm)
            return CacheHit(pcm=pcm, source=remote.name)
        return None

    async def set(self, key: str, pcm: bytes) -> None:
        for remote in self._remotes:
            await remote.set(key, pcm)


class TwoLayerAudioCache:
    def __init__(self, *, local: LocalAudioCache, remote: RemoteChainAudioCache | None) -> None:
        self._local = local
        self._remote = remote

    @property
    def remote_enabled(self) -> bool:
        return self._remote is not None and self._remote.enabled

    @property
    def remote_backends(self) -> list[str]:
        if self._remote is None:
            return []
        return self._remote.backends

    async def get(self, key: str) -> CacheHit | None:
        pcm = await self._local.get(key)
        if pcm is not None:
            return CacheHit(pcm=pcm, source="local")

        if self._remote and self._remote.enabled:
            hit = await self._remote.get(key)
            if hit is not None:
                await self._local.set(key, hit.pcm)
                return hit
        return None

    async def set(self, key: str, pcm: bytes) -> None:
        await self._local.set(key, pcm)
        if self._remote and self._remote.enabled:
            await self._remote.set(key, pcm)


_TTS_CACHE: TwoLayerAudioCache | None = None


def get_tts_cache() -> TwoLayerAudioCache:
    global _TTS_CACHE
    if _TTS_CACHE is None:
        remotes: list[RemoteAudioCache] = []
        if TTS_CACHE_REDIS_URL:
            remotes.append(
                RedisAudioCache(
                    redis_url=TTS_CACHE_REDIS_URL,
                    ttl_sec=TTS_CACHE_REDIS_TTL_SEC,
                    max_audio_bytes=TTS_CACHE_MAX_AUDIO_BYTES,
                )
            )
        _TTS_CACHE = TwoLayerAudioCache(
            local=LocalAudioCache(
                max_items=TTS_CACHE_LOCAL_MAX_ITEMS,
                max_bytes=TTS_CACHE_LOCAL_MAX_BYTES,
            ),
            remote=RemoteChainAudioCache(remotes) if remotes else None,
        )
    return _TTS_CACHE


async def post_voice_usage(
    *,
    conversation_id: str,
    agent_id: str,
    provider: str,
    service: str,
    model: str,
    duration_ms: int = 0,
    characters: int = 0,
) -> None:
    """Post STT/TTS usage metrics to the gateway for cost tracking."""
    payload = {
        "conversationId": conversation_id,
        "agentId": agent_id,
        "provider": provider,
        "service": service,
        "model": model,
        "durationMs": duration_ms,
        "characters": characters,
    }
    timeout = aiohttp.ClientTimeout(total=1.0, sock_connect=0.4, sock_read=0.6)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{GATEWAY_URL}/api/voice/usage", json=payload) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logger.warning(f"voice/usage failed status={resp.status}: {body[:160]}")
    except Exception as e:
        logger.warning(f"Failed posting voice usage: {type(e).__name__}: {e}")


async def post_voice_cache_metrics(
    *,
    conversation_id: str,
    agent_id: str,
    message_id: str | None,
    provider: str,
    model: str,
    voice: str,
    metrics: VoiceCacheTurnMetrics,
) -> None:
    if not metrics.has_data():
        return
    payload = {
        "conversationId": conversation_id,
        "agentId": agent_id,
        "messageId": message_id,
        "provider": provider,
        "model": model,
        "voice": voice,
        "metrics": {
            "segments": metrics.segments,
            "cacheHits": metrics.cache_hits,
            "cacheMisses": metrics.cache_misses,
            "cacheHitChars": metrics.cache_hit_chars,
            "cacheMissChars": metrics.cache_miss_chars,
            "cacheHitAudioBytes": metrics.cache_hit_audio_bytes,
            "cacheMissAudioBytes": metrics.cache_miss_audio_bytes,
        },
    }
    timeout = aiohttp.ClientTimeout(total=1.0, sock_connect=0.4, sock_read=0.6)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(f"{GATEWAY_URL}/api/voice/cache-metrics", json=payload) as resp:
                if resp.status >= 300:
                    body = await resp.text()
                    logger.warning(f"voice/cache-metrics failed status={resp.status}: {body[:160]}")
                else:
                    logger.info(
                        "Voice cache metrics posted: "
                        f"hits={metrics.cache_hits} misses={metrics.cache_misses} "
                        f"hit_chars={metrics.cache_hit_chars} miss_chars={metrics.cache_miss_chars}"
                    )
    except Exception as e:
        logger.warning(f"Failed posting voice cache metrics: {type(e).__name__}: {e}")


_NO_RETRY_CONN_OPTIONS = APIConnectOptions(
    max_retry=0,
    timeout=DEFAULT_API_CONNECT_OPTIONS.timeout,
)


class CachedStreamAdapter(lk_tts.StreamAdapter):
    def __init__(
        self,
        *,
        tts: lk_tts.TTS,
        cache: TwoLayerAudioCache,
        cache_fingerprint: dict[str, Any],
        report_cache_metrics: Any | None = None,
        sentence_tokenizer: NotGivenOr[tokenize.SentenceTokenizer] = NOT_GIVEN,
    ) -> None:
        super().__init__(tts=tts, sentence_tokenizer=sentence_tokenizer)
        self._cache = cache
        self._cache_fingerprint = cache_fingerprint
        self._report_cache_metrics = report_cache_metrics

    def stream(
        self, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "_CachedStreamAdapterWrapper":
        return _CachedStreamAdapterWrapper(tts=self, conn_options=conn_options)

    def _is_cacheable(self, text: str) -> bool:
        normalized = _normalize_cache_text(text)
        return bool(normalized) and len(normalized) <= TTS_CACHE_MAX_TEXT_CHARS

    def _cache_key(self, text: str) -> str:
        return _build_tts_cache_key(text=text, fingerprint=self._cache_fingerprint)

    def _pcm_duration(self, pcm: bytes) -> float:
        bytes_per_sample = 2  # pcm_s16le
        denom = self.sample_rate * self.num_channels * bytes_per_sample
        if denom <= 0:
            return 0.0
        return len(pcm) / denom


class _CachedStreamAdapterWrapper(lk_tts.SynthesizeStream):
    _tts_request_span_name = "tts_cache_stream_adapter"

    def __init__(self, *, tts: CachedStreamAdapter, conn_options: APIConnectOptions) -> None:
        super().__init__(tts=tts, conn_options=_NO_RETRY_CONN_OPTIONS)
        self._tts: CachedStreamAdapter = tts
        self._wrapped_tts_conn_options = conn_options

    async def _metrics_monitor_task(
        self, event_aiter: AsyncIterable[lk_tts.SynthesizedAudio]
    ) -> None:
        # Wrapped TTS providers already emit metrics for synthesize calls.
        return

    async def _run(self, output_emitter: lk_tts.AudioEmitter) -> None:
        sent_stream = self._tts._sentence_tokenizer.stream()
        if self._tts._stream_pacer:
            sent_stream = self._tts._stream_pacer.wrap(
                sent_stream=sent_stream,
                audio_emitter=output_emitter,
            )

        request_id = lk_utils.shortuuid()
        output_emitter.initialize(
            request_id=request_id,
            sample_rate=self._tts.sample_rate,
            num_channels=self._tts.num_channels,
            mime_type="audio/pcm",
            stream=True,
        )

        segment_id = lk_utils.shortuuid()
        output_emitter.start_segment(segment_id=segment_id)

        async def _forward_input() -> None:
            async for data in self._input_ch:
                if isinstance(data, self._FlushSentinel):
                    sent_stream.flush()
                    continue
                sent_stream.push_text(data)
            sent_stream.end_input()

        async def _synthesize() -> None:
            from livekit.agents.voice.io import TimedString

            duration = 0.0
            turn_metrics = VoiceCacheTurnMetrics()
            async for ev in sent_stream:
                output_emitter.push_timed_transcript(
                    TimedString(text=ev.token, start_time=duration)
                )

                text = ev.token.strip()
                if not text:
                    continue

                turn_metrics.segments += 1
                cache_hit: CacheHit | None = None
                cache_key = self._tts._cache_key(text)
                if self._tts._is_cacheable(text):
                    cache_hit = await self._tts._cache.get(cache_key)

                if cache_hit is not None:
                    output_emitter.push(cache_hit.pcm)
                    duration += self._tts._pcm_duration(cache_hit.pcm)
                    output_emitter.flush()
                    turn_metrics.cache_hits += 1
                    turn_metrics.cache_hit_chars += len(text)
                    turn_metrics.cache_hit_audio_bytes += len(cache_hit.pcm)
                    logger.info(
                        f"TTS cache hit ({cache_hit.source}) chars={len(text)} bytes={len(cache_hit.pcm)}"
                    )
                    continue

                pcm_buffer = bytearray()
                try:
                    async with self._tts._wrapped_tts.synthesize(
                        text, conn_options=self._wrapped_tts_conn_options
                    ) as tts_stream:
                        async for audio in tts_stream:
                            pcm = audio.frame.data.tobytes()
                            pcm_buffer.extend(pcm)
                            output_emitter.push(pcm)
                            duration += audio.frame.duration
                        output_emitter.flush()
                except Exception as e:
                    logger.error(f"TTS synthesis failed for segment ({len(text)} chars): {e}")
                    continue

                if pcm_buffer and self._tts._is_cacheable(text):
                    pcm = bytes(pcm_buffer)
                    if len(pcm) <= TTS_CACHE_MAX_AUDIO_BYTES:
                        await self._tts._cache.set(cache_key, pcm)
                        logger.info(
                            f"TTS cache store chars={len(text)} bytes={len(pcm)} remote={self._tts._cache.remote_enabled}"
                        )
                    turn_metrics.cache_misses += 1
                    turn_metrics.cache_miss_chars += len(text)
                    turn_metrics.cache_miss_audio_bytes += len(pcm)
                elif self._tts._is_cacheable(text):
                    turn_metrics.cache_misses += 1
                    turn_metrics.cache_miss_chars += len(text)

            if self._tts._report_cache_metrics:
                await self._tts._report_cache_metrics(turn_metrics)

        tasks = [
            asyncio.create_task(_forward_input()),
            asyncio.create_task(_synthesize()),
        ]
        try:
            await asyncio.gather(*tasks)
        finally:
            await sent_stream.aclose()
            await lk_utils.aio.cancel_and_wait(*tasks)


# ── JOI Agent ──

class JOIAgent(Agent):
    def __init__(self, conversation_id: str, agent_id: str, pending_turns: deque[dict[str, str]]):
        super().__init__(
            instructions="",
            llm=_StubLLM(),  # Required so pipeline doesn't skip LLM node
        )
        self.conversation_id = conversation_id
        self.agent_id = agent_id
        self.pending_turns = pending_turns

    async def llm_node(
        self,
        chat_ctx: llm.ChatContext,
        tools: list,
        model_settings: ModelSettings,
    ) -> AsyncIterable[str]:
        """Override LLM node to call gateway /api/voice/chat SSE endpoint."""
        logger.info(f"llm_node called, chat_ctx items: {len(chat_ctx.items)}")

        # Extract last user message text
        user_text = ""
        for item in reversed(chat_ctx.items):
            if getattr(item, "role", None) != "user":
                continue

            # Prefer LiveKit's helper when present.
            text_content = getattr(item, "text_content", None)
            if isinstance(text_content, str) and text_content.strip():
                user_text = text_content
                break

            for part in getattr(item, "content", []):
                if isinstance(part, str) and part.strip():
                    user_text = part
                    break
            if user_text:
                break

        if not user_text.strip():
            logger.info("No user text found, skipping")
            return

        logger.info(f"User text: {user_text[:200]!r}")

        voice_prompt_suffix = build_voice_prompt(LK_CONFIG)
        push_replace, flush_replace = build_pronunciation_replacer(
            LK_CONFIG.get("pronunciations", [])
        )

        payload = {
            "conversationId": self.conversation_id,
            "agentId": self.agent_id,
            "message": user_text,
            "voicePromptSuffix": voice_prompt_suffix,
        }
        turn_started = time.perf_counter()

        timeout = aiohttp.ClientTimeout(
            total=None,
            sock_connect=VOICE_CHAT_CONNECT_TIMEOUT_S,
            sock_read=VOICE_CHAT_READ_TIMEOUT_S,
        )

        for attempt in range(1, VOICE_CHAT_MAX_ATTEMPTS + 1):
            chunk_count = 0
            first_chunk_ms = None
            try:
                async with aiohttp.ClientSession(timeout=timeout) as session:
                    async with session.post(
                        f"{GATEWAY_URL}/api/voice/chat",
                        json=payload,
                        headers={"Accept": "text/event-stream"},
                    ) as resp:
                        if resp.status != 200:
                            body = await resp.text()
                            logger.error(f"Gateway returned {resp.status}: {body}")
                            yield "Sorry, I encountered an error."
                            return

                        async for line in resp.content:
                            line = line.decode("utf-8").strip()
                            if not line.startswith("data: "):
                                continue

                            data = json.loads(line[6:])

                            if data["type"] == "stream":
                                delta = data["delta"]
                                chunk_count += 1
                                if first_chunk_ms is None:
                                    first_chunk_ms = (time.perf_counter() - turn_started) * 1000
                                if chunk_count <= 3 or chunk_count % 20 == 0:
                                    logger.info(f"Stream chunk #{chunk_count}: {delta[:80]!r}")
                                replaced = push_replace(delta)
                                if replaced:
                                    cleaned = strip_voice_markers(replaced)
                                    if cleaned:
                                        yield cleaned

                            elif data["type"] == "done":
                                message_id = data.get("messageId")
                                if isinstance(message_id, str) and message_id:
                                    self.pending_turns.append(
                                        {
                                            "conversationId": self.conversation_id,
                                            "agentId": self.agent_id,
                                            "messageId": message_id,
                                        }
                                    )
                                remaining = flush_replace()
                                if remaining:
                                    cleaned_remaining = strip_voice_markers(remaining)
                                    if cleaned_remaining:
                                        yield cleaned_remaining
                                total_ms = (time.perf_counter() - turn_started) * 1000
                                metrics_parts = [
                                    f"chunks={chunk_count}",
                                    f"model={data.get('model')}",
                                    f"tool_model={data.get('toolModel')}" if data.get("toolModel") else None,
                                    f"usage={data.get('usage')}",
                                    f"total_ms={total_ms:.0f}",
                                    f"gateway_latency_ms={data.get('latencyMs')}",
                                ]
                                metrics_parts = [part for part in metrics_parts if part]
                                if first_chunk_ms is not None:
                                    metrics_parts.append(f"first_chunk_ms={first_chunk_ms:.0f}")
                                logger.info("Stream done: " + ", ".join(metrics_parts))
                                return

                            elif data["type"] == "error":
                                logger.error(f"Gateway error: {data.get('error')}")
                                yield "Sorry, I encountered an error."
                                return

            except (aiohttp.ClientError, asyncio.TimeoutError) as e:
                is_retryable = chunk_count == 0 and attempt < VOICE_CHAT_MAX_ATTEMPTS
                if is_retryable:
                    backoff_s = 0.3 * attempt
                    logger.warning(
                        f"SSE attempt {attempt}/{VOICE_CHAT_MAX_ATTEMPTS} failed before stream "
                        f"started ({type(e).__name__}: {e}); retrying in {backoff_s:.1f}s"
                    )
                    await asyncio.sleep(backoff_s)
                    continue

                logger.exception(f"SSE connection failed on attempt {attempt}: {e}")
                yield "Sorry, I couldn't connect to the server."
                return
            except Exception as e:
                logger.exception(f"SSE connection failed on attempt {attempt}: {e}")
                yield "Sorry, I couldn't connect to the server."
                return


# ── Server setup ──

server = AgentServer()


@server.rtc_session(agent_name="joi-voice")
async def entrypoint(ctx: agents.JobContext):
    """Handle a new voice session."""
    # Parse room metadata for conversationId / agentId
    conversation_id = None
    agent_id = "personal"

    room_meta = ctx.room.metadata
    if room_meta:
        try:
            meta = json.loads(room_meta)
            conversation_id = meta.get("conversationId")
            agent_id = meta.get("agentId", "personal")
        except (json.JSONDecodeError, TypeError):
            pass

    # Fallback #1: parse room name (`joi-voice-<conversationId>`)
    if not conversation_id:
        room_name = ctx.room.name or ""
        prefix = "joi-voice-"
        if room_name.startswith(prefix):
            tail = room_name[len(prefix):].strip()
            if tail:
                conversation_id = tail

    # Fallback #2: parse participant metadata (token metadata)
    if not conversation_id:
        try:
            for participant in ctx.room.remote_participants.values():
                if not participant.metadata:
                    continue
                try:
                    pmeta = json.loads(participant.metadata)
                except (json.JSONDecodeError, TypeError):
                    continue
                conv = pmeta.get("conversationId")
                if conv:
                    conversation_id = conv
                if pmeta.get("agentId"):
                    agent_id = pmeta.get("agentId")
                if conversation_id:
                    break
        except Exception:
            # Best-effort fallback only; keep startup resilient.
            pass

    if not conversation_id:
        import uuid
        conversation_id = str(uuid.uuid4())

    pending_turns: deque[dict[str, str]] = deque()

    logger.info(
        f"Entering room {ctx.room.name}, "
        f"conversation={conversation_id}, agent={agent_id}"
    )

    # Build STT
    stt_model = LK_CONFIG.get("sttModel", "nova-2-general")
    deepgram_key = LK_CONFIG.get("deepgramApiKey") or os.environ.get("DEEPGRAM_API_KEY", "")
    logger.info(f"STT: deepgram, model={stt_model}, key={'present' if deepgram_key else 'MISSING'}")

    stt_language = LK_CONFIG.get("language", "en-US")
    # Normalize short codes to Deepgram-compatible codes
    if stt_language == "en":
        stt_language = "en-US"
    elif stt_language == "de":
        stt_language = "de"
    elif len(stt_language) == 2:
        stt_language = stt_language  # Deepgram accepts 2-letter codes for most languages
    logger.info(f"STT language: {stt_language}")

    stt = DebugDeepgramSTT(
        model=stt_model,
        api_key=deepgram_key,
        language=stt_language,
        sample_rate=24000,
        interim_results=True,
        punctuate=True,
        smart_format=True,
    )

    # Build TTS
    tts_model = LK_CONFIG.get("ttsModel", "sonic-2")
    tts_voice = LK_CONFIG.get("ttsVoice")
    cartesia_key = LK_CONFIG.get("cartesiaApiKey") or os.environ.get("CARTESIA_API_KEY", "")
    logger.info(f"TTS: cartesia, model={tts_model}, voice={tts_voice or 'default'}, key={'present' if cartesia_key else 'MISSING'}")

    base_tts = cartesia.TTS(
        model=tts_model,
        api_key=cartesia_key,
        voice=tts_voice,
    )

    async def report_cache_metrics(turn_metrics: VoiceCacheTurnMetrics) -> None:
        turn_meta = pending_turns.popleft() if pending_turns else None
        await post_voice_cache_metrics(
            conversation_id=conversation_id,
            agent_id=agent_id,
            message_id=turn_meta["messageId"] if turn_meta else None,
            provider="cartesia",
            model=tts_model,
            voice=tts_voice or "",
            metrics=turn_metrics,
        )

    tts_engine: lk_tts.TTS = base_tts
    if TTS_CACHE_ENABLED:
        cache = get_tts_cache()
        tts_engine = CachedStreamAdapter(
            tts=base_tts,
            cache=cache,
            cache_fingerprint={
                "provider": "cartesia",
                "model": tts_model,
                "voice": tts_voice or "",
                "sample_rate": base_tts.sample_rate,
                "num_channels": base_tts.num_channels,
            },
            report_cache_metrics=report_cache_metrics,
        )
        logger.info(
            "TTS cache enabled: "
            f"local_max_items={TTS_CACHE_LOCAL_MAX_ITEMS}, "
            f"local_max_bytes={TTS_CACHE_LOCAL_MAX_BYTES}, "
            f"remote_enabled={cache.remote_enabled}, "
            f"remote_backends={','.join(cache.remote_backends) if cache.remote_backends else 'none'}, "
            f"max_text_chars={TTS_CACHE_MAX_TEXT_CHARS}, "
            f"max_audio_bytes={TTS_CACHE_MAX_AUDIO_BYTES}"
        )
    else:
        logger.info("TTS cache disabled")

    session = AgentSession(
        stt=stt,
        tts=tts_engine,
        # STT turn detection is more robust here than VAD for low mic levels.
        turn_detection="stt",
        min_endpointing_delay=VOICE_MIN_ENDPOINT_DELAY_S,
        max_endpointing_delay=VOICE_MAX_ENDPOINT_DELAY_S,
    )

    agent = JOIAgent(
        conversation_id=conversation_id,
        agent_id=agent_id,
        pending_turns=pending_turns,
    )

    # Debug event listeners
    session.on("agent_state_changed", lambda ev: logger.info(f"AgentState: {ev.old_state} -> {ev.new_state}"))
    session.on("user_state_changed", lambda ev: logger.info(f"UserState: {ev.old_state} -> {ev.new_state}"))
    session.on("user_input_transcribed", lambda ev: logger.info(f"UserTranscript {'[FINAL]' if ev.is_final else '[interim]'}: {ev.transcript[:120]!r}"))
    session.on("error", lambda ev: logger.error(f"Session error: {ev.error}"))
    session.on("close", lambda ev: logger.info(f"Session closed: {ev.reason}"))
    stt.on("error", lambda ev: logger.error(f"STT error: {ev.error} (recoverable={ev.recoverable})"))

    def _on_stt_metrics(ev):
        logger.info(
            "STT metrics: "
            f"audio_duration={ev.audio_duration:.2f}s, "
            f"streamed={ev.streamed}, "
            f"request_id={ev.request_id or '-'}"
        )
        duration_ms = int(ev.audio_duration * 1000)
        if duration_ms > 0:
            asyncio.ensure_future(
                post_voice_usage(
                    conversation_id=conversation_id,
                    agent_id=agent_id,
                    provider="deepgram",
                    service="stt",
                    model=stt_model,
                    duration_ms=duration_ms,
                )
            )

    stt.on("metrics_collected", _on_stt_metrics)

    def _on_tts_metrics(ev):
        chars = getattr(ev, "characters_count", 0)
        audio_dur = getattr(ev, "audio_duration", 0.0)
        logger.info(
            "TTS metrics: "
            f"chars={chars}, "
            f"audio_duration={audio_dur:.2f}s, "
            f"ttfb={getattr(ev, 'ttfb', 0):.3f}s, "
            f"request_id={getattr(ev, 'request_id', '-')}"
        )

    base_tts.on("metrics_collected", _on_tts_metrics)

    # Non-invasive room diagnostics (safe: does not consume media streams)
    @ctx.room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        logger.info(
            f"Participant connected: identity={participant.identity}, kind={participant.kind}"
        )

    @ctx.room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        logger.info(
            f"Participant disconnected: identity={participant.identity}, reason={participant.disconnect_reason}"
        )

    @ctx.room.on("track_subscribed")
    def on_track_subscribed(
        track: rtc.RemoteTrack,
        publication: rtc.RemoteTrackPublication,
        participant: rtc.RemoteParticipant,
    ):
        logger.info(
            "Track subscribed: "
            f"participant={participant.identity}, "
            f"kind={track.kind}, "
            f"source={publication.source}, "
            f"muted={publication.muted}"
        )

    await session.start(
        room=ctx.room,
        agent=agent,
    )

    logger.info("Voice session started")


if __name__ == "__main__":
    # Load .env from project root
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
        logger.info(f"Loaded .env from {env_path}")

    agents.cli.run_app(server)
