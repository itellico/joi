import 'package:freezed_annotation/freezed_annotation.dart';

part 'frame.freezed.dart';
part 'frame.g.dart';

@freezed
class Frame with _$Frame {
  const factory Frame({
    required String type,
    String? id,
    Map<String, dynamic>? data,
    String? error,
  }) = _Frame;

  factory Frame.fromJson(Map<String, dynamic> json) => _$FrameFromJson(json);
}

@freezed
class ChatSendData with _$ChatSendData {
  const factory ChatSendData({
    String? conversationId,
    String? agentId,
    required String content,
    String? mode,
    List<AttachmentData>? attachments,
  }) = _ChatSendData;

  factory ChatSendData.fromJson(Map<String, dynamic> json) =>
      _$ChatSendDataFromJson(json);
}

@freezed
class AttachmentData with _$AttachmentData {
  const factory AttachmentData({
    required String type,
    String? url,
    String? data,
    String? name,
  }) = _AttachmentData;

  factory AttachmentData.fromJson(Map<String, dynamic> json) =>
      _$AttachmentDataFromJson(json);
}

@freezed
class ChatStreamData with _$ChatStreamData {
  const factory ChatStreamData({
    required String conversationId,
    required String messageId,
    required String delta,
    String? model,
  }) = _ChatStreamData;

  factory ChatStreamData.fromJson(Map<String, dynamic> json) =>
      _$ChatStreamDataFromJson(json);
}

@freezed
class ChatDoneData with _$ChatDoneData {
  const factory ChatDoneData({
    required String conversationId,
    required String messageId,
    required String content,
    required String model,
    UsageData? usage,
  }) = _ChatDoneData;

  factory ChatDoneData.fromJson(Map<String, dynamic> json) =>
      _$ChatDoneDataFromJson(json);
}

@freezed
class UsageData with _$UsageData {
  const factory UsageData({
    required int inputTokens,
    required int outputTokens,
  }) = _UsageData;

  factory UsageData.fromJson(Map<String, dynamic> json) =>
      _$UsageDataFromJson(json);
}

@freezed
class ChatToolUseData with _$ChatToolUseData {
  const factory ChatToolUseData({
    required String conversationId,
    required String messageId,
    required String toolName,
    dynamic toolInput,
    required String toolUseId,
  }) = _ChatToolUseData;

  factory ChatToolUseData.fromJson(Map<String, dynamic> json) =>
      _$ChatToolUseDataFromJson(json);
}

@freezed
class ChatToolResultData with _$ChatToolResultData {
  const factory ChatToolResultData({
    required String conversationId,
    required String messageId,
    required String toolUseId,
    dynamic result,
  }) = _ChatToolResultData;

  factory ChatToolResultData.fromJson(Map<String, dynamic> json) =>
      _$ChatToolResultDataFromJson(json);
}

@freezed
class SessionInfo with _$SessionInfo {
  const factory SessionInfo({
    required String id,
    String? title,
    required String agentId,
    required int messageCount,
    String? lastMessage,
    required String updatedAt,
  }) = _SessionInfo;

  factory SessionInfo.fromJson(Map<String, dynamic> json) =>
      _$SessionInfoFromJson(json);
}

@freezed
class SessionListData with _$SessionListData {
  const factory SessionListData({
    required List<SessionInfo> sessions,
  }) = _SessionListData;

  factory SessionListData.fromJson(Map<String, dynamic> json) =>
      _$SessionListDataFromJson(json);
}

@freezed
class SessionHistoryData with _$SessionHistoryData {
  const factory SessionHistoryData({
    required String conversationId,
    required List<MessageInfo> messages,
  }) = _SessionHistoryData;

  factory SessionHistoryData.fromJson(Map<String, dynamic> json) =>
      _$SessionHistoryDataFromJson(json);
}

@freezed
class MessageInfo with _$MessageInfo {
  const factory MessageInfo({
    required String id,
    required String role,
    String? content,
    dynamic toolCalls,
    dynamic toolResults,
    String? model,
    required String createdAt,
  }) = _MessageInfo;

  factory MessageInfo.fromJson(Map<String, dynamic> json) =>
      _$MessageInfoFromJson(json);
}

@freezed
class AgentInfo with _$AgentInfo {
  const factory AgentInfo({
    required String id,
    required String name,
    String? description,
    String? model,
    required bool enabled,
  }) = _AgentInfo;

  factory AgentInfo.fromJson(Map<String, dynamic> json) =>
      _$AgentInfoFromJson(json);
}
