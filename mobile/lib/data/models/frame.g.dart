// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'frame.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

_$FrameImpl _$$FrameImplFromJson(Map<String, dynamic> json) => _$FrameImpl(
  type: json['type'] as String,
  id: json['id'] as String?,
  data: json['data'] as Map<String, dynamic>?,
  error: json['error'] as String?,
);

Map<String, dynamic> _$$FrameImplToJson(_$FrameImpl instance) =>
    <String, dynamic>{
      'type': instance.type,
      'id': instance.id,
      'data': instance.data,
      'error': instance.error,
    };

_$ChatSendDataImpl _$$ChatSendDataImplFromJson(Map<String, dynamic> json) =>
    _$ChatSendDataImpl(
      conversationId: json['conversationId'] as String?,
      agentId: json['agentId'] as String?,
      content: json['content'] as String,
      mode: json['mode'] as String?,
      attachments: (json['attachments'] as List<dynamic>?)
          ?.map((e) => AttachmentData.fromJson(e as Map<String, dynamic>))
          .toList(),
    );

Map<String, dynamic> _$$ChatSendDataImplToJson(_$ChatSendDataImpl instance) =>
    <String, dynamic>{
      'conversationId': instance.conversationId,
      'agentId': instance.agentId,
      'content': instance.content,
      'mode': instance.mode,
      'attachments': instance.attachments,
    };

_$AttachmentDataImpl _$$AttachmentDataImplFromJson(Map<String, dynamic> json) =>
    _$AttachmentDataImpl(
      type: json['type'] as String,
      url: json['url'] as String?,
      data: json['data'] as String?,
      name: json['name'] as String?,
    );

Map<String, dynamic> _$$AttachmentDataImplToJson(
  _$AttachmentDataImpl instance,
) => <String, dynamic>{
  'type': instance.type,
  'url': instance.url,
  'data': instance.data,
  'name': instance.name,
};

_$ChatStreamDataImpl _$$ChatStreamDataImplFromJson(Map<String, dynamic> json) =>
    _$ChatStreamDataImpl(
      conversationId: json['conversationId'] as String,
      messageId: json['messageId'] as String,
      delta: json['delta'] as String,
      model: json['model'] as String?,
    );

Map<String, dynamic> _$$ChatStreamDataImplToJson(
  _$ChatStreamDataImpl instance,
) => <String, dynamic>{
  'conversationId': instance.conversationId,
  'messageId': instance.messageId,
  'delta': instance.delta,
  'model': instance.model,
};

_$ChatDoneDataImpl _$$ChatDoneDataImplFromJson(Map<String, dynamic> json) =>
    _$ChatDoneDataImpl(
      conversationId: json['conversationId'] as String,
      messageId: json['messageId'] as String,
      content: json['content'] as String,
      model: json['model'] as String,
      usage: json['usage'] == null
          ? null
          : UsageData.fromJson(json['usage'] as Map<String, dynamic>),
    );

Map<String, dynamic> _$$ChatDoneDataImplToJson(_$ChatDoneDataImpl instance) =>
    <String, dynamic>{
      'conversationId': instance.conversationId,
      'messageId': instance.messageId,
      'content': instance.content,
      'model': instance.model,
      'usage': instance.usage,
    };

_$UsageDataImpl _$$UsageDataImplFromJson(Map<String, dynamic> json) =>
    _$UsageDataImpl(
      inputTokens: (json['inputTokens'] as num).toInt(),
      outputTokens: (json['outputTokens'] as num).toInt(),
    );

Map<String, dynamic> _$$UsageDataImplToJson(_$UsageDataImpl instance) =>
    <String, dynamic>{
      'inputTokens': instance.inputTokens,
      'outputTokens': instance.outputTokens,
    };

_$ChatToolUseDataImpl _$$ChatToolUseDataImplFromJson(
  Map<String, dynamic> json,
) => _$ChatToolUseDataImpl(
  conversationId: json['conversationId'] as String,
  messageId: json['messageId'] as String,
  toolName: json['toolName'] as String,
  toolInput: json['toolInput'],
  toolUseId: json['toolUseId'] as String,
);

Map<String, dynamic> _$$ChatToolUseDataImplToJson(
  _$ChatToolUseDataImpl instance,
) => <String, dynamic>{
  'conversationId': instance.conversationId,
  'messageId': instance.messageId,
  'toolName': instance.toolName,
  'toolInput': instance.toolInput,
  'toolUseId': instance.toolUseId,
};

_$ChatToolResultDataImpl _$$ChatToolResultDataImplFromJson(
  Map<String, dynamic> json,
) => _$ChatToolResultDataImpl(
  conversationId: json['conversationId'] as String,
  messageId: json['messageId'] as String,
  toolUseId: json['toolUseId'] as String,
  result: json['result'],
);

Map<String, dynamic> _$$ChatToolResultDataImplToJson(
  _$ChatToolResultDataImpl instance,
) => <String, dynamic>{
  'conversationId': instance.conversationId,
  'messageId': instance.messageId,
  'toolUseId': instance.toolUseId,
  'result': instance.result,
};

_$SessionInfoImpl _$$SessionInfoImplFromJson(Map<String, dynamic> json) =>
    _$SessionInfoImpl(
      id: json['id'] as String,
      title: json['title'] as String?,
      agentId: json['agentId'] as String,
      messageCount: (json['messageCount'] as num).toInt(),
      lastMessage: json['lastMessage'] as String?,
      updatedAt: json['updatedAt'] as String,
    );

Map<String, dynamic> _$$SessionInfoImplToJson(_$SessionInfoImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'title': instance.title,
      'agentId': instance.agentId,
      'messageCount': instance.messageCount,
      'lastMessage': instance.lastMessage,
      'updatedAt': instance.updatedAt,
    };

_$SessionListDataImpl _$$SessionListDataImplFromJson(
  Map<String, dynamic> json,
) => _$SessionListDataImpl(
  sessions: (json['sessions'] as List<dynamic>)
      .map((e) => SessionInfo.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$$SessionListDataImplToJson(
  _$SessionListDataImpl instance,
) => <String, dynamic>{'sessions': instance.sessions};

_$SessionHistoryDataImpl _$$SessionHistoryDataImplFromJson(
  Map<String, dynamic> json,
) => _$SessionHistoryDataImpl(
  conversationId: json['conversationId'] as String,
  messages: (json['messages'] as List<dynamic>)
      .map((e) => MessageInfo.fromJson(e as Map<String, dynamic>))
      .toList(),
);

Map<String, dynamic> _$$SessionHistoryDataImplToJson(
  _$SessionHistoryDataImpl instance,
) => <String, dynamic>{
  'conversationId': instance.conversationId,
  'messages': instance.messages,
};

_$MessageInfoImpl _$$MessageInfoImplFromJson(Map<String, dynamic> json) =>
    _$MessageInfoImpl(
      id: json['id'] as String,
      role: json['role'] as String,
      content: json['content'] as String?,
      toolCalls: json['toolCalls'],
      toolResults: json['toolResults'],
      model: json['model'] as String?,
      createdAt: json['createdAt'] as String,
    );

Map<String, dynamic> _$$MessageInfoImplToJson(_$MessageInfoImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'role': instance.role,
      'content': instance.content,
      'toolCalls': instance.toolCalls,
      'toolResults': instance.toolResults,
      'model': instance.model,
      'createdAt': instance.createdAt,
    };

_$AgentInfoImpl _$$AgentInfoImplFromJson(Map<String, dynamic> json) =>
    _$AgentInfoImpl(
      id: json['id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      model: json['model'] as String?,
      enabled: json['enabled'] as bool,
    );

Map<String, dynamic> _$$AgentInfoImplToJson(_$AgentInfoImpl instance) =>
    <String, dynamic>{
      'id': instance.id,
      'name': instance.name,
      'description': instance.description,
      'model': instance.model,
      'enabled': instance.enabled,
    };
