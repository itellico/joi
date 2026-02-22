// coverage:ignore-file
// GENERATED CODE - DO NOT MODIFY BY HAND
// ignore_for_file: type=lint
// ignore_for_file: unused_element, deprecated_member_use, deprecated_member_use_from_same_package, use_function_type_syntax_for_parameters, unnecessary_const, avoid_init_to_null, invalid_override_different_default_values_named, prefer_expression_function_bodies, annotate_overrides, invalid_annotation_target, unnecessary_question_mark

part of 'frame.dart';

// **************************************************************************
// FreezedGenerator
// **************************************************************************

T _$identity<T>(T value) => value;

final _privateConstructorUsedError = UnsupportedError(
  'It seems like you constructed your class using `MyClass._()`. This constructor is only meant to be used by freezed and you are not supposed to need it nor use it.\nPlease check the documentation here for more information: https://github.com/rrousselGit/freezed#adding-getters-and-methods-to-our-models',
);

Frame _$FrameFromJson(Map<String, dynamic> json) {
  return _Frame.fromJson(json);
}

/// @nodoc
mixin _$Frame {
  String get type => throw _privateConstructorUsedError;
  String? get id => throw _privateConstructorUsedError;
  Map<String, dynamic>? get data => throw _privateConstructorUsedError;
  String? get error => throw _privateConstructorUsedError;

  /// Serializes this Frame to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of Frame
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $FrameCopyWith<Frame> get copyWith => throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $FrameCopyWith<$Res> {
  factory $FrameCopyWith(Frame value, $Res Function(Frame) then) =
      _$FrameCopyWithImpl<$Res, Frame>;
  @useResult
  $Res call({
    String type,
    String? id,
    Map<String, dynamic>? data,
    String? error,
  });
}

/// @nodoc
class _$FrameCopyWithImpl<$Res, $Val extends Frame>
    implements $FrameCopyWith<$Res> {
  _$FrameCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of Frame
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? id = freezed,
    Object? data = freezed,
    Object? error = freezed,
  }) {
    return _then(
      _value.copyWith(
            type: null == type
                ? _value.type
                : type // ignore: cast_nullable_to_non_nullable
                      as String,
            id: freezed == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String?,
            data: freezed == data
                ? _value.data
                : data // ignore: cast_nullable_to_non_nullable
                      as Map<String, dynamic>?,
            error: freezed == error
                ? _value.error
                : error // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$FrameImplCopyWith<$Res> implements $FrameCopyWith<$Res> {
  factory _$$FrameImplCopyWith(
    _$FrameImpl value,
    $Res Function(_$FrameImpl) then,
  ) = __$$FrameImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String type,
    String? id,
    Map<String, dynamic>? data,
    String? error,
  });
}

/// @nodoc
class __$$FrameImplCopyWithImpl<$Res>
    extends _$FrameCopyWithImpl<$Res, _$FrameImpl>
    implements _$$FrameImplCopyWith<$Res> {
  __$$FrameImplCopyWithImpl(
    _$FrameImpl _value,
    $Res Function(_$FrameImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of Frame
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? id = freezed,
    Object? data = freezed,
    Object? error = freezed,
  }) {
    return _then(
      _$FrameImpl(
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        id: freezed == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String?,
        data: freezed == data
            ? _value._data
            : data // ignore: cast_nullable_to_non_nullable
                  as Map<String, dynamic>?,
        error: freezed == error
            ? _value.error
            : error // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$FrameImpl implements _Frame {
  const _$FrameImpl({
    required this.type,
    this.id,
    final Map<String, dynamic>? data,
    this.error,
  }) : _data = data;

  factory _$FrameImpl.fromJson(Map<String, dynamic> json) =>
      _$$FrameImplFromJson(json);

  @override
  final String type;
  @override
  final String? id;
  final Map<String, dynamic>? _data;
  @override
  Map<String, dynamic>? get data {
    final value = _data;
    if (value == null) return null;
    if (_data is EqualUnmodifiableMapView) return _data;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableMapView(value);
  }

  @override
  final String? error;

  @override
  String toString() {
    return 'Frame(type: $type, id: $id, data: $data, error: $error)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$FrameImpl &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.id, id) || other.id == id) &&
            const DeepCollectionEquality().equals(other._data, _data) &&
            (identical(other.error, error) || other.error == error));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    type,
    id,
    const DeepCollectionEquality().hash(_data),
    error,
  );

  /// Create a copy of Frame
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$FrameImplCopyWith<_$FrameImpl> get copyWith =>
      __$$FrameImplCopyWithImpl<_$FrameImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$FrameImplToJson(this);
  }
}

abstract class _Frame implements Frame {
  const factory _Frame({
    required final String type,
    final String? id,
    final Map<String, dynamic>? data,
    final String? error,
  }) = _$FrameImpl;

  factory _Frame.fromJson(Map<String, dynamic> json) = _$FrameImpl.fromJson;

  @override
  String get type;
  @override
  String? get id;
  @override
  Map<String, dynamic>? get data;
  @override
  String? get error;

  /// Create a copy of Frame
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$FrameImplCopyWith<_$FrameImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatSendData _$ChatSendDataFromJson(Map<String, dynamic> json) {
  return _ChatSendData.fromJson(json);
}

/// @nodoc
mixin _$ChatSendData {
  String? get conversationId => throw _privateConstructorUsedError;
  String? get agentId => throw _privateConstructorUsedError;
  String get content => throw _privateConstructorUsedError;
  String? get mode => throw _privateConstructorUsedError;
  List<AttachmentData>? get attachments => throw _privateConstructorUsedError;

  /// Serializes this ChatSendData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatSendData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatSendDataCopyWith<ChatSendData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatSendDataCopyWith<$Res> {
  factory $ChatSendDataCopyWith(
    ChatSendData value,
    $Res Function(ChatSendData) then,
  ) = _$ChatSendDataCopyWithImpl<$Res, ChatSendData>;
  @useResult
  $Res call({
    String? conversationId,
    String? agentId,
    String content,
    String? mode,
    List<AttachmentData>? attachments,
  });
}

/// @nodoc
class _$ChatSendDataCopyWithImpl<$Res, $Val extends ChatSendData>
    implements $ChatSendDataCopyWith<$Res> {
  _$ChatSendDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatSendData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = freezed,
    Object? agentId = freezed,
    Object? content = null,
    Object? mode = freezed,
    Object? attachments = freezed,
  }) {
    return _then(
      _value.copyWith(
            conversationId: freezed == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String?,
            agentId: freezed == agentId
                ? _value.agentId
                : agentId // ignore: cast_nullable_to_non_nullable
                      as String?,
            content: null == content
                ? _value.content
                : content // ignore: cast_nullable_to_non_nullable
                      as String,
            mode: freezed == mode
                ? _value.mode
                : mode // ignore: cast_nullable_to_non_nullable
                      as String?,
            attachments: freezed == attachments
                ? _value.attachments
                : attachments // ignore: cast_nullable_to_non_nullable
                      as List<AttachmentData>?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ChatSendDataImplCopyWith<$Res>
    implements $ChatSendDataCopyWith<$Res> {
  factory _$$ChatSendDataImplCopyWith(
    _$ChatSendDataImpl value,
    $Res Function(_$ChatSendDataImpl) then,
  ) = __$$ChatSendDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String? conversationId,
    String? agentId,
    String content,
    String? mode,
    List<AttachmentData>? attachments,
  });
}

/// @nodoc
class __$$ChatSendDataImplCopyWithImpl<$Res>
    extends _$ChatSendDataCopyWithImpl<$Res, _$ChatSendDataImpl>
    implements _$$ChatSendDataImplCopyWith<$Res> {
  __$$ChatSendDataImplCopyWithImpl(
    _$ChatSendDataImpl _value,
    $Res Function(_$ChatSendDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatSendData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = freezed,
    Object? agentId = freezed,
    Object? content = null,
    Object? mode = freezed,
    Object? attachments = freezed,
  }) {
    return _then(
      _$ChatSendDataImpl(
        conversationId: freezed == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String?,
        agentId: freezed == agentId
            ? _value.agentId
            : agentId // ignore: cast_nullable_to_non_nullable
                  as String?,
        content: null == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String,
        mode: freezed == mode
            ? _value.mode
            : mode // ignore: cast_nullable_to_non_nullable
                  as String?,
        attachments: freezed == attachments
            ? _value._attachments
            : attachments // ignore: cast_nullable_to_non_nullable
                  as List<AttachmentData>?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatSendDataImpl implements _ChatSendData {
  const _$ChatSendDataImpl({
    this.conversationId,
    this.agentId,
    required this.content,
    this.mode,
    final List<AttachmentData>? attachments,
  }) : _attachments = attachments;

  factory _$ChatSendDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatSendDataImplFromJson(json);

  @override
  final String? conversationId;
  @override
  final String? agentId;
  @override
  final String content;
  @override
  final String? mode;
  final List<AttachmentData>? _attachments;
  @override
  List<AttachmentData>? get attachments {
    final value = _attachments;
    if (value == null) return null;
    if (_attachments is EqualUnmodifiableListView) return _attachments;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(value);
  }

  @override
  String toString() {
    return 'ChatSendData(conversationId: $conversationId, agentId: $agentId, content: $content, mode: $mode, attachments: $attachments)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatSendDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.content, content) || other.content == content) &&
            (identical(other.mode, mode) || other.mode == mode) &&
            const DeepCollectionEquality().equals(
              other._attachments,
              _attachments,
            ));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    conversationId,
    agentId,
    content,
    mode,
    const DeepCollectionEquality().hash(_attachments),
  );

  /// Create a copy of ChatSendData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatSendDataImplCopyWith<_$ChatSendDataImpl> get copyWith =>
      __$$ChatSendDataImplCopyWithImpl<_$ChatSendDataImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatSendDataImplToJson(this);
  }
}

abstract class _ChatSendData implements ChatSendData {
  const factory _ChatSendData({
    final String? conversationId,
    final String? agentId,
    required final String content,
    final String? mode,
    final List<AttachmentData>? attachments,
  }) = _$ChatSendDataImpl;

  factory _ChatSendData.fromJson(Map<String, dynamic> json) =
      _$ChatSendDataImpl.fromJson;

  @override
  String? get conversationId;
  @override
  String? get agentId;
  @override
  String get content;
  @override
  String? get mode;
  @override
  List<AttachmentData>? get attachments;

  /// Create a copy of ChatSendData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatSendDataImplCopyWith<_$ChatSendDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

AttachmentData _$AttachmentDataFromJson(Map<String, dynamic> json) {
  return _AttachmentData.fromJson(json);
}

/// @nodoc
mixin _$AttachmentData {
  String get type => throw _privateConstructorUsedError;
  String? get url => throw _privateConstructorUsedError;
  String? get data => throw _privateConstructorUsedError;
  String? get name => throw _privateConstructorUsedError;

  /// Serializes this AttachmentData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AttachmentData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AttachmentDataCopyWith<AttachmentData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AttachmentDataCopyWith<$Res> {
  factory $AttachmentDataCopyWith(
    AttachmentData value,
    $Res Function(AttachmentData) then,
  ) = _$AttachmentDataCopyWithImpl<$Res, AttachmentData>;
  @useResult
  $Res call({String type, String? url, String? data, String? name});
}

/// @nodoc
class _$AttachmentDataCopyWithImpl<$Res, $Val extends AttachmentData>
    implements $AttachmentDataCopyWith<$Res> {
  _$AttachmentDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AttachmentData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? url = freezed,
    Object? data = freezed,
    Object? name = freezed,
  }) {
    return _then(
      _value.copyWith(
            type: null == type
                ? _value.type
                : type // ignore: cast_nullable_to_non_nullable
                      as String,
            url: freezed == url
                ? _value.url
                : url // ignore: cast_nullable_to_non_nullable
                      as String?,
            data: freezed == data
                ? _value.data
                : data // ignore: cast_nullable_to_non_nullable
                      as String?,
            name: freezed == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AttachmentDataImplCopyWith<$Res>
    implements $AttachmentDataCopyWith<$Res> {
  factory _$$AttachmentDataImplCopyWith(
    _$AttachmentDataImpl value,
    $Res Function(_$AttachmentDataImpl) then,
  ) = __$$AttachmentDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String type, String? url, String? data, String? name});
}

/// @nodoc
class __$$AttachmentDataImplCopyWithImpl<$Res>
    extends _$AttachmentDataCopyWithImpl<$Res, _$AttachmentDataImpl>
    implements _$$AttachmentDataImplCopyWith<$Res> {
  __$$AttachmentDataImplCopyWithImpl(
    _$AttachmentDataImpl _value,
    $Res Function(_$AttachmentDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AttachmentData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? type = null,
    Object? url = freezed,
    Object? data = freezed,
    Object? name = freezed,
  }) {
    return _then(
      _$AttachmentDataImpl(
        type: null == type
            ? _value.type
            : type // ignore: cast_nullable_to_non_nullable
                  as String,
        url: freezed == url
            ? _value.url
            : url // ignore: cast_nullable_to_non_nullable
                  as String?,
        data: freezed == data
            ? _value.data
            : data // ignore: cast_nullable_to_non_nullable
                  as String?,
        name: freezed == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AttachmentDataImpl implements _AttachmentData {
  const _$AttachmentDataImpl({
    required this.type,
    this.url,
    this.data,
    this.name,
  });

  factory _$AttachmentDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$AttachmentDataImplFromJson(json);

  @override
  final String type;
  @override
  final String? url;
  @override
  final String? data;
  @override
  final String? name;

  @override
  String toString() {
    return 'AttachmentData(type: $type, url: $url, data: $data, name: $name)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AttachmentDataImpl &&
            (identical(other.type, type) || other.type == type) &&
            (identical(other.url, url) || other.url == url) &&
            (identical(other.data, data) || other.data == data) &&
            (identical(other.name, name) || other.name == name));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, type, url, data, name);

  /// Create a copy of AttachmentData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AttachmentDataImplCopyWith<_$AttachmentDataImpl> get copyWith =>
      __$$AttachmentDataImplCopyWithImpl<_$AttachmentDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$AttachmentDataImplToJson(this);
  }
}

abstract class _AttachmentData implements AttachmentData {
  const factory _AttachmentData({
    required final String type,
    final String? url,
    final String? data,
    final String? name,
  }) = _$AttachmentDataImpl;

  factory _AttachmentData.fromJson(Map<String, dynamic> json) =
      _$AttachmentDataImpl.fromJson;

  @override
  String get type;
  @override
  String? get url;
  @override
  String? get data;
  @override
  String? get name;

  /// Create a copy of AttachmentData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AttachmentDataImplCopyWith<_$AttachmentDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatStreamData _$ChatStreamDataFromJson(Map<String, dynamic> json) {
  return _ChatStreamData.fromJson(json);
}

/// @nodoc
mixin _$ChatStreamData {
  String get conversationId => throw _privateConstructorUsedError;
  String get messageId => throw _privateConstructorUsedError;
  String get delta => throw _privateConstructorUsedError;
  String? get model => throw _privateConstructorUsedError;

  /// Serializes this ChatStreamData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatStreamData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatStreamDataCopyWith<ChatStreamData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatStreamDataCopyWith<$Res> {
  factory $ChatStreamDataCopyWith(
    ChatStreamData value,
    $Res Function(ChatStreamData) then,
  ) = _$ChatStreamDataCopyWithImpl<$Res, ChatStreamData>;
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String delta,
    String? model,
  });
}

/// @nodoc
class _$ChatStreamDataCopyWithImpl<$Res, $Val extends ChatStreamData>
    implements $ChatStreamDataCopyWith<$Res> {
  _$ChatStreamDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatStreamData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? delta = null,
    Object? model = freezed,
  }) {
    return _then(
      _value.copyWith(
            conversationId: null == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String,
            messageId: null == messageId
                ? _value.messageId
                : messageId // ignore: cast_nullable_to_non_nullable
                      as String,
            delta: null == delta
                ? _value.delta
                : delta // ignore: cast_nullable_to_non_nullable
                      as String,
            model: freezed == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String?,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ChatStreamDataImplCopyWith<$Res>
    implements $ChatStreamDataCopyWith<$Res> {
  factory _$$ChatStreamDataImplCopyWith(
    _$ChatStreamDataImpl value,
    $Res Function(_$ChatStreamDataImpl) then,
  ) = __$$ChatStreamDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String delta,
    String? model,
  });
}

/// @nodoc
class __$$ChatStreamDataImplCopyWithImpl<$Res>
    extends _$ChatStreamDataCopyWithImpl<$Res, _$ChatStreamDataImpl>
    implements _$$ChatStreamDataImplCopyWith<$Res> {
  __$$ChatStreamDataImplCopyWithImpl(
    _$ChatStreamDataImpl _value,
    $Res Function(_$ChatStreamDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatStreamData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? delta = null,
    Object? model = freezed,
  }) {
    return _then(
      _$ChatStreamDataImpl(
        conversationId: null == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String,
        messageId: null == messageId
            ? _value.messageId
            : messageId // ignore: cast_nullable_to_non_nullable
                  as String,
        delta: null == delta
            ? _value.delta
            : delta // ignore: cast_nullable_to_non_nullable
                  as String,
        model: freezed == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatStreamDataImpl implements _ChatStreamData {
  const _$ChatStreamDataImpl({
    required this.conversationId,
    required this.messageId,
    required this.delta,
    this.model,
  });

  factory _$ChatStreamDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatStreamDataImplFromJson(json);

  @override
  final String conversationId;
  @override
  final String messageId;
  @override
  final String delta;
  @override
  final String? model;

  @override
  String toString() {
    return 'ChatStreamData(conversationId: $conversationId, messageId: $messageId, delta: $delta, model: $model)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatStreamDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            (identical(other.messageId, messageId) ||
                other.messageId == messageId) &&
            (identical(other.delta, delta) || other.delta == delta) &&
            (identical(other.model, model) || other.model == model));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, conversationId, messageId, delta, model);

  /// Create a copy of ChatStreamData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatStreamDataImplCopyWith<_$ChatStreamDataImpl> get copyWith =>
      __$$ChatStreamDataImplCopyWithImpl<_$ChatStreamDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatStreamDataImplToJson(this);
  }
}

abstract class _ChatStreamData implements ChatStreamData {
  const factory _ChatStreamData({
    required final String conversationId,
    required final String messageId,
    required final String delta,
    final String? model,
  }) = _$ChatStreamDataImpl;

  factory _ChatStreamData.fromJson(Map<String, dynamic> json) =
      _$ChatStreamDataImpl.fromJson;

  @override
  String get conversationId;
  @override
  String get messageId;
  @override
  String get delta;
  @override
  String? get model;

  /// Create a copy of ChatStreamData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatStreamDataImplCopyWith<_$ChatStreamDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatDoneData _$ChatDoneDataFromJson(Map<String, dynamic> json) {
  return _ChatDoneData.fromJson(json);
}

/// @nodoc
mixin _$ChatDoneData {
  String get conversationId => throw _privateConstructorUsedError;
  String get messageId => throw _privateConstructorUsedError;
  String get content => throw _privateConstructorUsedError;
  String get model => throw _privateConstructorUsedError;
  UsageData? get usage => throw _privateConstructorUsedError;

  /// Serializes this ChatDoneData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatDoneDataCopyWith<ChatDoneData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatDoneDataCopyWith<$Res> {
  factory $ChatDoneDataCopyWith(
    ChatDoneData value,
    $Res Function(ChatDoneData) then,
  ) = _$ChatDoneDataCopyWithImpl<$Res, ChatDoneData>;
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String content,
    String model,
    UsageData? usage,
  });

  $UsageDataCopyWith<$Res>? get usage;
}

/// @nodoc
class _$ChatDoneDataCopyWithImpl<$Res, $Val extends ChatDoneData>
    implements $ChatDoneDataCopyWith<$Res> {
  _$ChatDoneDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? content = null,
    Object? model = null,
    Object? usage = freezed,
  }) {
    return _then(
      _value.copyWith(
            conversationId: null == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String,
            messageId: null == messageId
                ? _value.messageId
                : messageId // ignore: cast_nullable_to_non_nullable
                      as String,
            content: null == content
                ? _value.content
                : content // ignore: cast_nullable_to_non_nullable
                      as String,
            model: null == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String,
            usage: freezed == usage
                ? _value.usage
                : usage // ignore: cast_nullable_to_non_nullable
                      as UsageData?,
          )
          as $Val,
    );
  }

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @pragma('vm:prefer-inline')
  $UsageDataCopyWith<$Res>? get usage {
    if (_value.usage == null) {
      return null;
    }

    return $UsageDataCopyWith<$Res>(_value.usage!, (value) {
      return _then(_value.copyWith(usage: value) as $Val);
    });
  }
}

/// @nodoc
abstract class _$$ChatDoneDataImplCopyWith<$Res>
    implements $ChatDoneDataCopyWith<$Res> {
  factory _$$ChatDoneDataImplCopyWith(
    _$ChatDoneDataImpl value,
    $Res Function(_$ChatDoneDataImpl) then,
  ) = __$$ChatDoneDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String content,
    String model,
    UsageData? usage,
  });

  @override
  $UsageDataCopyWith<$Res>? get usage;
}

/// @nodoc
class __$$ChatDoneDataImplCopyWithImpl<$Res>
    extends _$ChatDoneDataCopyWithImpl<$Res, _$ChatDoneDataImpl>
    implements _$$ChatDoneDataImplCopyWith<$Res> {
  __$$ChatDoneDataImplCopyWithImpl(
    _$ChatDoneDataImpl _value,
    $Res Function(_$ChatDoneDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? content = null,
    Object? model = null,
    Object? usage = freezed,
  }) {
    return _then(
      _$ChatDoneDataImpl(
        conversationId: null == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String,
        messageId: null == messageId
            ? _value.messageId
            : messageId // ignore: cast_nullable_to_non_nullable
                  as String,
        content: null == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String,
        model: null == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String,
        usage: freezed == usage
            ? _value.usage
            : usage // ignore: cast_nullable_to_non_nullable
                  as UsageData?,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatDoneDataImpl implements _ChatDoneData {
  const _$ChatDoneDataImpl({
    required this.conversationId,
    required this.messageId,
    required this.content,
    required this.model,
    this.usage,
  });

  factory _$ChatDoneDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatDoneDataImplFromJson(json);

  @override
  final String conversationId;
  @override
  final String messageId;
  @override
  final String content;
  @override
  final String model;
  @override
  final UsageData? usage;

  @override
  String toString() {
    return 'ChatDoneData(conversationId: $conversationId, messageId: $messageId, content: $content, model: $model, usage: $usage)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatDoneDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            (identical(other.messageId, messageId) ||
                other.messageId == messageId) &&
            (identical(other.content, content) || other.content == content) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.usage, usage) || other.usage == usage));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    conversationId,
    messageId,
    content,
    model,
    usage,
  );

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatDoneDataImplCopyWith<_$ChatDoneDataImpl> get copyWith =>
      __$$ChatDoneDataImplCopyWithImpl<_$ChatDoneDataImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatDoneDataImplToJson(this);
  }
}

abstract class _ChatDoneData implements ChatDoneData {
  const factory _ChatDoneData({
    required final String conversationId,
    required final String messageId,
    required final String content,
    required final String model,
    final UsageData? usage,
  }) = _$ChatDoneDataImpl;

  factory _ChatDoneData.fromJson(Map<String, dynamic> json) =
      _$ChatDoneDataImpl.fromJson;

  @override
  String get conversationId;
  @override
  String get messageId;
  @override
  String get content;
  @override
  String get model;
  @override
  UsageData? get usage;

  /// Create a copy of ChatDoneData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatDoneDataImplCopyWith<_$ChatDoneDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

UsageData _$UsageDataFromJson(Map<String, dynamic> json) {
  return _UsageData.fromJson(json);
}

/// @nodoc
mixin _$UsageData {
  int get inputTokens => throw _privateConstructorUsedError;
  int get outputTokens => throw _privateConstructorUsedError;

  /// Serializes this UsageData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of UsageData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $UsageDataCopyWith<UsageData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $UsageDataCopyWith<$Res> {
  factory $UsageDataCopyWith(UsageData value, $Res Function(UsageData) then) =
      _$UsageDataCopyWithImpl<$Res, UsageData>;
  @useResult
  $Res call({int inputTokens, int outputTokens});
}

/// @nodoc
class _$UsageDataCopyWithImpl<$Res, $Val extends UsageData>
    implements $UsageDataCopyWith<$Res> {
  _$UsageDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of UsageData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? inputTokens = null, Object? outputTokens = null}) {
    return _then(
      _value.copyWith(
            inputTokens: null == inputTokens
                ? _value.inputTokens
                : inputTokens // ignore: cast_nullable_to_non_nullable
                      as int,
            outputTokens: null == outputTokens
                ? _value.outputTokens
                : outputTokens // ignore: cast_nullable_to_non_nullable
                      as int,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$UsageDataImplCopyWith<$Res>
    implements $UsageDataCopyWith<$Res> {
  factory _$$UsageDataImplCopyWith(
    _$UsageDataImpl value,
    $Res Function(_$UsageDataImpl) then,
  ) = __$$UsageDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({int inputTokens, int outputTokens});
}

/// @nodoc
class __$$UsageDataImplCopyWithImpl<$Res>
    extends _$UsageDataCopyWithImpl<$Res, _$UsageDataImpl>
    implements _$$UsageDataImplCopyWith<$Res> {
  __$$UsageDataImplCopyWithImpl(
    _$UsageDataImpl _value,
    $Res Function(_$UsageDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of UsageData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? inputTokens = null, Object? outputTokens = null}) {
    return _then(
      _$UsageDataImpl(
        inputTokens: null == inputTokens
            ? _value.inputTokens
            : inputTokens // ignore: cast_nullable_to_non_nullable
                  as int,
        outputTokens: null == outputTokens
            ? _value.outputTokens
            : outputTokens // ignore: cast_nullable_to_non_nullable
                  as int,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$UsageDataImpl implements _UsageData {
  const _$UsageDataImpl({
    required this.inputTokens,
    required this.outputTokens,
  });

  factory _$UsageDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$UsageDataImplFromJson(json);

  @override
  final int inputTokens;
  @override
  final int outputTokens;

  @override
  String toString() {
    return 'UsageData(inputTokens: $inputTokens, outputTokens: $outputTokens)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$UsageDataImpl &&
            (identical(other.inputTokens, inputTokens) ||
                other.inputTokens == inputTokens) &&
            (identical(other.outputTokens, outputTokens) ||
                other.outputTokens == outputTokens));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(runtimeType, inputTokens, outputTokens);

  /// Create a copy of UsageData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$UsageDataImplCopyWith<_$UsageDataImpl> get copyWith =>
      __$$UsageDataImplCopyWithImpl<_$UsageDataImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$UsageDataImplToJson(this);
  }
}

abstract class _UsageData implements UsageData {
  const factory _UsageData({
    required final int inputTokens,
    required final int outputTokens,
  }) = _$UsageDataImpl;

  factory _UsageData.fromJson(Map<String, dynamic> json) =
      _$UsageDataImpl.fromJson;

  @override
  int get inputTokens;
  @override
  int get outputTokens;

  /// Create a copy of UsageData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$UsageDataImplCopyWith<_$UsageDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatToolUseData _$ChatToolUseDataFromJson(Map<String, dynamic> json) {
  return _ChatToolUseData.fromJson(json);
}

/// @nodoc
mixin _$ChatToolUseData {
  String get conversationId => throw _privateConstructorUsedError;
  String get messageId => throw _privateConstructorUsedError;
  String get toolName => throw _privateConstructorUsedError;
  dynamic get toolInput => throw _privateConstructorUsedError;
  String get toolUseId => throw _privateConstructorUsedError;

  /// Serializes this ChatToolUseData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatToolUseData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatToolUseDataCopyWith<ChatToolUseData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatToolUseDataCopyWith<$Res> {
  factory $ChatToolUseDataCopyWith(
    ChatToolUseData value,
    $Res Function(ChatToolUseData) then,
  ) = _$ChatToolUseDataCopyWithImpl<$Res, ChatToolUseData>;
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String toolName,
    dynamic toolInput,
    String toolUseId,
  });
}

/// @nodoc
class _$ChatToolUseDataCopyWithImpl<$Res, $Val extends ChatToolUseData>
    implements $ChatToolUseDataCopyWith<$Res> {
  _$ChatToolUseDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatToolUseData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? toolName = null,
    Object? toolInput = freezed,
    Object? toolUseId = null,
  }) {
    return _then(
      _value.copyWith(
            conversationId: null == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String,
            messageId: null == messageId
                ? _value.messageId
                : messageId // ignore: cast_nullable_to_non_nullable
                      as String,
            toolName: null == toolName
                ? _value.toolName
                : toolName // ignore: cast_nullable_to_non_nullable
                      as String,
            toolInput: freezed == toolInput
                ? _value.toolInput
                : toolInput // ignore: cast_nullable_to_non_nullable
                      as dynamic,
            toolUseId: null == toolUseId
                ? _value.toolUseId
                : toolUseId // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ChatToolUseDataImplCopyWith<$Res>
    implements $ChatToolUseDataCopyWith<$Res> {
  factory _$$ChatToolUseDataImplCopyWith(
    _$ChatToolUseDataImpl value,
    $Res Function(_$ChatToolUseDataImpl) then,
  ) = __$$ChatToolUseDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String toolName,
    dynamic toolInput,
    String toolUseId,
  });
}

/// @nodoc
class __$$ChatToolUseDataImplCopyWithImpl<$Res>
    extends _$ChatToolUseDataCopyWithImpl<$Res, _$ChatToolUseDataImpl>
    implements _$$ChatToolUseDataImplCopyWith<$Res> {
  __$$ChatToolUseDataImplCopyWithImpl(
    _$ChatToolUseDataImpl _value,
    $Res Function(_$ChatToolUseDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatToolUseData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? toolName = null,
    Object? toolInput = freezed,
    Object? toolUseId = null,
  }) {
    return _then(
      _$ChatToolUseDataImpl(
        conversationId: null == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String,
        messageId: null == messageId
            ? _value.messageId
            : messageId // ignore: cast_nullable_to_non_nullable
                  as String,
        toolName: null == toolName
            ? _value.toolName
            : toolName // ignore: cast_nullable_to_non_nullable
                  as String,
        toolInput: freezed == toolInput
            ? _value.toolInput
            : toolInput // ignore: cast_nullable_to_non_nullable
                  as dynamic,
        toolUseId: null == toolUseId
            ? _value.toolUseId
            : toolUseId // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatToolUseDataImpl implements _ChatToolUseData {
  const _$ChatToolUseDataImpl({
    required this.conversationId,
    required this.messageId,
    required this.toolName,
    this.toolInput,
    required this.toolUseId,
  });

  factory _$ChatToolUseDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatToolUseDataImplFromJson(json);

  @override
  final String conversationId;
  @override
  final String messageId;
  @override
  final String toolName;
  @override
  final dynamic toolInput;
  @override
  final String toolUseId;

  @override
  String toString() {
    return 'ChatToolUseData(conversationId: $conversationId, messageId: $messageId, toolName: $toolName, toolInput: $toolInput, toolUseId: $toolUseId)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatToolUseDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            (identical(other.messageId, messageId) ||
                other.messageId == messageId) &&
            (identical(other.toolName, toolName) ||
                other.toolName == toolName) &&
            const DeepCollectionEquality().equals(other.toolInput, toolInput) &&
            (identical(other.toolUseId, toolUseId) ||
                other.toolUseId == toolUseId));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    conversationId,
    messageId,
    toolName,
    const DeepCollectionEquality().hash(toolInput),
    toolUseId,
  );

  /// Create a copy of ChatToolUseData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatToolUseDataImplCopyWith<_$ChatToolUseDataImpl> get copyWith =>
      __$$ChatToolUseDataImplCopyWithImpl<_$ChatToolUseDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatToolUseDataImplToJson(this);
  }
}

abstract class _ChatToolUseData implements ChatToolUseData {
  const factory _ChatToolUseData({
    required final String conversationId,
    required final String messageId,
    required final String toolName,
    final dynamic toolInput,
    required final String toolUseId,
  }) = _$ChatToolUseDataImpl;

  factory _ChatToolUseData.fromJson(Map<String, dynamic> json) =
      _$ChatToolUseDataImpl.fromJson;

  @override
  String get conversationId;
  @override
  String get messageId;
  @override
  String get toolName;
  @override
  dynamic get toolInput;
  @override
  String get toolUseId;

  /// Create a copy of ChatToolUseData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatToolUseDataImplCopyWith<_$ChatToolUseDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

ChatToolResultData _$ChatToolResultDataFromJson(Map<String, dynamic> json) {
  return _ChatToolResultData.fromJson(json);
}

/// @nodoc
mixin _$ChatToolResultData {
  String get conversationId => throw _privateConstructorUsedError;
  String get messageId => throw _privateConstructorUsedError;
  String get toolUseId => throw _privateConstructorUsedError;
  dynamic get result => throw _privateConstructorUsedError;

  /// Serializes this ChatToolResultData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of ChatToolResultData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $ChatToolResultDataCopyWith<ChatToolResultData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $ChatToolResultDataCopyWith<$Res> {
  factory $ChatToolResultDataCopyWith(
    ChatToolResultData value,
    $Res Function(ChatToolResultData) then,
  ) = _$ChatToolResultDataCopyWithImpl<$Res, ChatToolResultData>;
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String toolUseId,
    dynamic result,
  });
}

/// @nodoc
class _$ChatToolResultDataCopyWithImpl<$Res, $Val extends ChatToolResultData>
    implements $ChatToolResultDataCopyWith<$Res> {
  _$ChatToolResultDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of ChatToolResultData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? toolUseId = null,
    Object? result = freezed,
  }) {
    return _then(
      _value.copyWith(
            conversationId: null == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String,
            messageId: null == messageId
                ? _value.messageId
                : messageId // ignore: cast_nullable_to_non_nullable
                      as String,
            toolUseId: null == toolUseId
                ? _value.toolUseId
                : toolUseId // ignore: cast_nullable_to_non_nullable
                      as String,
            result: freezed == result
                ? _value.result
                : result // ignore: cast_nullable_to_non_nullable
                      as dynamic,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$ChatToolResultDataImplCopyWith<$Res>
    implements $ChatToolResultDataCopyWith<$Res> {
  factory _$$ChatToolResultDataImplCopyWith(
    _$ChatToolResultDataImpl value,
    $Res Function(_$ChatToolResultDataImpl) then,
  ) = __$$ChatToolResultDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String conversationId,
    String messageId,
    String toolUseId,
    dynamic result,
  });
}

/// @nodoc
class __$$ChatToolResultDataImplCopyWithImpl<$Res>
    extends _$ChatToolResultDataCopyWithImpl<$Res, _$ChatToolResultDataImpl>
    implements _$$ChatToolResultDataImplCopyWith<$Res> {
  __$$ChatToolResultDataImplCopyWithImpl(
    _$ChatToolResultDataImpl _value,
    $Res Function(_$ChatToolResultDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of ChatToolResultData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? conversationId = null,
    Object? messageId = null,
    Object? toolUseId = null,
    Object? result = freezed,
  }) {
    return _then(
      _$ChatToolResultDataImpl(
        conversationId: null == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String,
        messageId: null == messageId
            ? _value.messageId
            : messageId // ignore: cast_nullable_to_non_nullable
                  as String,
        toolUseId: null == toolUseId
            ? _value.toolUseId
            : toolUseId // ignore: cast_nullable_to_non_nullable
                  as String,
        result: freezed == result
            ? _value.result
            : result // ignore: cast_nullable_to_non_nullable
                  as dynamic,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$ChatToolResultDataImpl implements _ChatToolResultData {
  const _$ChatToolResultDataImpl({
    required this.conversationId,
    required this.messageId,
    required this.toolUseId,
    this.result,
  });

  factory _$ChatToolResultDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$ChatToolResultDataImplFromJson(json);

  @override
  final String conversationId;
  @override
  final String messageId;
  @override
  final String toolUseId;
  @override
  final dynamic result;

  @override
  String toString() {
    return 'ChatToolResultData(conversationId: $conversationId, messageId: $messageId, toolUseId: $toolUseId, result: $result)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$ChatToolResultDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            (identical(other.messageId, messageId) ||
                other.messageId == messageId) &&
            (identical(other.toolUseId, toolUseId) ||
                other.toolUseId == toolUseId) &&
            const DeepCollectionEquality().equals(other.result, result));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    conversationId,
    messageId,
    toolUseId,
    const DeepCollectionEquality().hash(result),
  );

  /// Create a copy of ChatToolResultData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$ChatToolResultDataImplCopyWith<_$ChatToolResultDataImpl> get copyWith =>
      __$$ChatToolResultDataImplCopyWithImpl<_$ChatToolResultDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$ChatToolResultDataImplToJson(this);
  }
}

abstract class _ChatToolResultData implements ChatToolResultData {
  const factory _ChatToolResultData({
    required final String conversationId,
    required final String messageId,
    required final String toolUseId,
    final dynamic result,
  }) = _$ChatToolResultDataImpl;

  factory _ChatToolResultData.fromJson(Map<String, dynamic> json) =
      _$ChatToolResultDataImpl.fromJson;

  @override
  String get conversationId;
  @override
  String get messageId;
  @override
  String get toolUseId;
  @override
  dynamic get result;

  /// Create a copy of ChatToolResultData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$ChatToolResultDataImplCopyWith<_$ChatToolResultDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

SessionInfo _$SessionInfoFromJson(Map<String, dynamic> json) {
  return _SessionInfo.fromJson(json);
}

/// @nodoc
mixin _$SessionInfo {
  String get id => throw _privateConstructorUsedError;
  String? get title => throw _privateConstructorUsedError;
  String get agentId => throw _privateConstructorUsedError;
  int get messageCount => throw _privateConstructorUsedError;
  String? get lastMessage => throw _privateConstructorUsedError;
  String get updatedAt => throw _privateConstructorUsedError;

  /// Serializes this SessionInfo to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionInfoCopyWith<SessionInfo> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionInfoCopyWith<$Res> {
  factory $SessionInfoCopyWith(
    SessionInfo value,
    $Res Function(SessionInfo) then,
  ) = _$SessionInfoCopyWithImpl<$Res, SessionInfo>;
  @useResult
  $Res call({
    String id,
    String? title,
    String agentId,
    int messageCount,
    String? lastMessage,
    String updatedAt,
  });
}

/// @nodoc
class _$SessionInfoCopyWithImpl<$Res, $Val extends SessionInfo>
    implements $SessionInfoCopyWith<$Res> {
  _$SessionInfoCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? title = freezed,
    Object? agentId = null,
    Object? messageCount = null,
    Object? lastMessage = freezed,
    Object? updatedAt = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            title: freezed == title
                ? _value.title
                : title // ignore: cast_nullable_to_non_nullable
                      as String?,
            agentId: null == agentId
                ? _value.agentId
                : agentId // ignore: cast_nullable_to_non_nullable
                      as String,
            messageCount: null == messageCount
                ? _value.messageCount
                : messageCount // ignore: cast_nullable_to_non_nullable
                      as int,
            lastMessage: freezed == lastMessage
                ? _value.lastMessage
                : lastMessage // ignore: cast_nullable_to_non_nullable
                      as String?,
            updatedAt: null == updatedAt
                ? _value.updatedAt
                : updatedAt // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SessionInfoImplCopyWith<$Res>
    implements $SessionInfoCopyWith<$Res> {
  factory _$$SessionInfoImplCopyWith(
    _$SessionInfoImpl value,
    $Res Function(_$SessionInfoImpl) then,
  ) = __$$SessionInfoImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String? title,
    String agentId,
    int messageCount,
    String? lastMessage,
    String updatedAt,
  });
}

/// @nodoc
class __$$SessionInfoImplCopyWithImpl<$Res>
    extends _$SessionInfoCopyWithImpl<$Res, _$SessionInfoImpl>
    implements _$$SessionInfoImplCopyWith<$Res> {
  __$$SessionInfoImplCopyWithImpl(
    _$SessionInfoImpl _value,
    $Res Function(_$SessionInfoImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? title = freezed,
    Object? agentId = null,
    Object? messageCount = null,
    Object? lastMessage = freezed,
    Object? updatedAt = null,
  }) {
    return _then(
      _$SessionInfoImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        title: freezed == title
            ? _value.title
            : title // ignore: cast_nullable_to_non_nullable
                  as String?,
        agentId: null == agentId
            ? _value.agentId
            : agentId // ignore: cast_nullable_to_non_nullable
                  as String,
        messageCount: null == messageCount
            ? _value.messageCount
            : messageCount // ignore: cast_nullable_to_non_nullable
                  as int,
        lastMessage: freezed == lastMessage
            ? _value.lastMessage
            : lastMessage // ignore: cast_nullable_to_non_nullable
                  as String?,
        updatedAt: null == updatedAt
            ? _value.updatedAt
            : updatedAt // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionInfoImpl implements _SessionInfo {
  const _$SessionInfoImpl({
    required this.id,
    this.title,
    required this.agentId,
    required this.messageCount,
    this.lastMessage,
    required this.updatedAt,
  });

  factory _$SessionInfoImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionInfoImplFromJson(json);

  @override
  final String id;
  @override
  final String? title;
  @override
  final String agentId;
  @override
  final int messageCount;
  @override
  final String? lastMessage;
  @override
  final String updatedAt;

  @override
  String toString() {
    return 'SessionInfo(id: $id, title: $title, agentId: $agentId, messageCount: $messageCount, lastMessage: $lastMessage, updatedAt: $updatedAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionInfoImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.title, title) || other.title == title) &&
            (identical(other.agentId, agentId) || other.agentId == agentId) &&
            (identical(other.messageCount, messageCount) ||
                other.messageCount == messageCount) &&
            (identical(other.lastMessage, lastMessage) ||
                other.lastMessage == lastMessage) &&
            (identical(other.updatedAt, updatedAt) ||
                other.updatedAt == updatedAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    title,
    agentId,
    messageCount,
    lastMessage,
    updatedAt,
  );

  /// Create a copy of SessionInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionInfoImplCopyWith<_$SessionInfoImpl> get copyWith =>
      __$$SessionInfoImplCopyWithImpl<_$SessionInfoImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionInfoImplToJson(this);
  }
}

abstract class _SessionInfo implements SessionInfo {
  const factory _SessionInfo({
    required final String id,
    final String? title,
    required final String agentId,
    required final int messageCount,
    final String? lastMessage,
    required final String updatedAt,
  }) = _$SessionInfoImpl;

  factory _SessionInfo.fromJson(Map<String, dynamic> json) =
      _$SessionInfoImpl.fromJson;

  @override
  String get id;
  @override
  String? get title;
  @override
  String get agentId;
  @override
  int get messageCount;
  @override
  String? get lastMessage;
  @override
  String get updatedAt;

  /// Create a copy of SessionInfo
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionInfoImplCopyWith<_$SessionInfoImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

SessionListData _$SessionListDataFromJson(Map<String, dynamic> json) {
  return _SessionListData.fromJson(json);
}

/// @nodoc
mixin _$SessionListData {
  List<SessionInfo> get sessions => throw _privateConstructorUsedError;

  /// Serializes this SessionListData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionListData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionListDataCopyWith<SessionListData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionListDataCopyWith<$Res> {
  factory $SessionListDataCopyWith(
    SessionListData value,
    $Res Function(SessionListData) then,
  ) = _$SessionListDataCopyWithImpl<$Res, SessionListData>;
  @useResult
  $Res call({List<SessionInfo> sessions});
}

/// @nodoc
class _$SessionListDataCopyWithImpl<$Res, $Val extends SessionListData>
    implements $SessionListDataCopyWith<$Res> {
  _$SessionListDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionListData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? sessions = null}) {
    return _then(
      _value.copyWith(
            sessions: null == sessions
                ? _value.sessions
                : sessions // ignore: cast_nullable_to_non_nullable
                      as List<SessionInfo>,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SessionListDataImplCopyWith<$Res>
    implements $SessionListDataCopyWith<$Res> {
  factory _$$SessionListDataImplCopyWith(
    _$SessionListDataImpl value,
    $Res Function(_$SessionListDataImpl) then,
  ) = __$$SessionListDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({List<SessionInfo> sessions});
}

/// @nodoc
class __$$SessionListDataImplCopyWithImpl<$Res>
    extends _$SessionListDataCopyWithImpl<$Res, _$SessionListDataImpl>
    implements _$$SessionListDataImplCopyWith<$Res> {
  __$$SessionListDataImplCopyWithImpl(
    _$SessionListDataImpl _value,
    $Res Function(_$SessionListDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionListData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? sessions = null}) {
    return _then(
      _$SessionListDataImpl(
        sessions: null == sessions
            ? _value._sessions
            : sessions // ignore: cast_nullable_to_non_nullable
                  as List<SessionInfo>,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionListDataImpl implements _SessionListData {
  const _$SessionListDataImpl({required final List<SessionInfo> sessions})
    : _sessions = sessions;

  factory _$SessionListDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionListDataImplFromJson(json);

  final List<SessionInfo> _sessions;
  @override
  List<SessionInfo> get sessions {
    if (_sessions is EqualUnmodifiableListView) return _sessions;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_sessions);
  }

  @override
  String toString() {
    return 'SessionListData(sessions: $sessions)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionListDataImpl &&
            const DeepCollectionEquality().equals(other._sessions, _sessions));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, const DeepCollectionEquality().hash(_sessions));

  /// Create a copy of SessionListData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionListDataImplCopyWith<_$SessionListDataImpl> get copyWith =>
      __$$SessionListDataImplCopyWithImpl<_$SessionListDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionListDataImplToJson(this);
  }
}

abstract class _SessionListData implements SessionListData {
  const factory _SessionListData({required final List<SessionInfo> sessions}) =
      _$SessionListDataImpl;

  factory _SessionListData.fromJson(Map<String, dynamic> json) =
      _$SessionListDataImpl.fromJson;

  @override
  List<SessionInfo> get sessions;

  /// Create a copy of SessionListData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionListDataImplCopyWith<_$SessionListDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

SessionHistoryData _$SessionHistoryDataFromJson(Map<String, dynamic> json) {
  return _SessionHistoryData.fromJson(json);
}

/// @nodoc
mixin _$SessionHistoryData {
  String get conversationId => throw _privateConstructorUsedError;
  List<MessageInfo> get messages => throw _privateConstructorUsedError;

  /// Serializes this SessionHistoryData to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of SessionHistoryData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $SessionHistoryDataCopyWith<SessionHistoryData> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $SessionHistoryDataCopyWith<$Res> {
  factory $SessionHistoryDataCopyWith(
    SessionHistoryData value,
    $Res Function(SessionHistoryData) then,
  ) = _$SessionHistoryDataCopyWithImpl<$Res, SessionHistoryData>;
  @useResult
  $Res call({String conversationId, List<MessageInfo> messages});
}

/// @nodoc
class _$SessionHistoryDataCopyWithImpl<$Res, $Val extends SessionHistoryData>
    implements $SessionHistoryDataCopyWith<$Res> {
  _$SessionHistoryDataCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of SessionHistoryData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? conversationId = null, Object? messages = null}) {
    return _then(
      _value.copyWith(
            conversationId: null == conversationId
                ? _value.conversationId
                : conversationId // ignore: cast_nullable_to_non_nullable
                      as String,
            messages: null == messages
                ? _value.messages
                : messages // ignore: cast_nullable_to_non_nullable
                      as List<MessageInfo>,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$SessionHistoryDataImplCopyWith<$Res>
    implements $SessionHistoryDataCopyWith<$Res> {
  factory _$$SessionHistoryDataImplCopyWith(
    _$SessionHistoryDataImpl value,
    $Res Function(_$SessionHistoryDataImpl) then,
  ) = __$$SessionHistoryDataImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({String conversationId, List<MessageInfo> messages});
}

/// @nodoc
class __$$SessionHistoryDataImplCopyWithImpl<$Res>
    extends _$SessionHistoryDataCopyWithImpl<$Res, _$SessionHistoryDataImpl>
    implements _$$SessionHistoryDataImplCopyWith<$Res> {
  __$$SessionHistoryDataImplCopyWithImpl(
    _$SessionHistoryDataImpl _value,
    $Res Function(_$SessionHistoryDataImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of SessionHistoryData
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({Object? conversationId = null, Object? messages = null}) {
    return _then(
      _$SessionHistoryDataImpl(
        conversationId: null == conversationId
            ? _value.conversationId
            : conversationId // ignore: cast_nullable_to_non_nullable
                  as String,
        messages: null == messages
            ? _value._messages
            : messages // ignore: cast_nullable_to_non_nullable
                  as List<MessageInfo>,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$SessionHistoryDataImpl implements _SessionHistoryData {
  const _$SessionHistoryDataImpl({
    required this.conversationId,
    required final List<MessageInfo> messages,
  }) : _messages = messages;

  factory _$SessionHistoryDataImpl.fromJson(Map<String, dynamic> json) =>
      _$$SessionHistoryDataImplFromJson(json);

  @override
  final String conversationId;
  final List<MessageInfo> _messages;
  @override
  List<MessageInfo> get messages {
    if (_messages is EqualUnmodifiableListView) return _messages;
    // ignore: implicit_dynamic_type
    return EqualUnmodifiableListView(_messages);
  }

  @override
  String toString() {
    return 'SessionHistoryData(conversationId: $conversationId, messages: $messages)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$SessionHistoryDataImpl &&
            (identical(other.conversationId, conversationId) ||
                other.conversationId == conversationId) &&
            const DeepCollectionEquality().equals(other._messages, _messages));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    conversationId,
    const DeepCollectionEquality().hash(_messages),
  );

  /// Create a copy of SessionHistoryData
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$SessionHistoryDataImplCopyWith<_$SessionHistoryDataImpl> get copyWith =>
      __$$SessionHistoryDataImplCopyWithImpl<_$SessionHistoryDataImpl>(
        this,
        _$identity,
      );

  @override
  Map<String, dynamic> toJson() {
    return _$$SessionHistoryDataImplToJson(this);
  }
}

abstract class _SessionHistoryData implements SessionHistoryData {
  const factory _SessionHistoryData({
    required final String conversationId,
    required final List<MessageInfo> messages,
  }) = _$SessionHistoryDataImpl;

  factory _SessionHistoryData.fromJson(Map<String, dynamic> json) =
      _$SessionHistoryDataImpl.fromJson;

  @override
  String get conversationId;
  @override
  List<MessageInfo> get messages;

  /// Create a copy of SessionHistoryData
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$SessionHistoryDataImplCopyWith<_$SessionHistoryDataImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

MessageInfo _$MessageInfoFromJson(Map<String, dynamic> json) {
  return _MessageInfo.fromJson(json);
}

/// @nodoc
mixin _$MessageInfo {
  String get id => throw _privateConstructorUsedError;
  String get role => throw _privateConstructorUsedError;
  String? get content => throw _privateConstructorUsedError;
  dynamic get toolCalls => throw _privateConstructorUsedError;
  dynamic get toolResults => throw _privateConstructorUsedError;
  String? get model => throw _privateConstructorUsedError;
  String get createdAt => throw _privateConstructorUsedError;

  /// Serializes this MessageInfo to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of MessageInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $MessageInfoCopyWith<MessageInfo> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $MessageInfoCopyWith<$Res> {
  factory $MessageInfoCopyWith(
    MessageInfo value,
    $Res Function(MessageInfo) then,
  ) = _$MessageInfoCopyWithImpl<$Res, MessageInfo>;
  @useResult
  $Res call({
    String id,
    String role,
    String? content,
    dynamic toolCalls,
    dynamic toolResults,
    String? model,
    String createdAt,
  });
}

/// @nodoc
class _$MessageInfoCopyWithImpl<$Res, $Val extends MessageInfo>
    implements $MessageInfoCopyWith<$Res> {
  _$MessageInfoCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of MessageInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? role = null,
    Object? content = freezed,
    Object? toolCalls = freezed,
    Object? toolResults = freezed,
    Object? model = freezed,
    Object? createdAt = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            role: null == role
                ? _value.role
                : role // ignore: cast_nullable_to_non_nullable
                      as String,
            content: freezed == content
                ? _value.content
                : content // ignore: cast_nullable_to_non_nullable
                      as String?,
            toolCalls: freezed == toolCalls
                ? _value.toolCalls
                : toolCalls // ignore: cast_nullable_to_non_nullable
                      as dynamic,
            toolResults: freezed == toolResults
                ? _value.toolResults
                : toolResults // ignore: cast_nullable_to_non_nullable
                      as dynamic,
            model: freezed == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String?,
            createdAt: null == createdAt
                ? _value.createdAt
                : createdAt // ignore: cast_nullable_to_non_nullable
                      as String,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$MessageInfoImplCopyWith<$Res>
    implements $MessageInfoCopyWith<$Res> {
  factory _$$MessageInfoImplCopyWith(
    _$MessageInfoImpl value,
    $Res Function(_$MessageInfoImpl) then,
  ) = __$$MessageInfoImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String role,
    String? content,
    dynamic toolCalls,
    dynamic toolResults,
    String? model,
    String createdAt,
  });
}

/// @nodoc
class __$$MessageInfoImplCopyWithImpl<$Res>
    extends _$MessageInfoCopyWithImpl<$Res, _$MessageInfoImpl>
    implements _$$MessageInfoImplCopyWith<$Res> {
  __$$MessageInfoImplCopyWithImpl(
    _$MessageInfoImpl _value,
    $Res Function(_$MessageInfoImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of MessageInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? role = null,
    Object? content = freezed,
    Object? toolCalls = freezed,
    Object? toolResults = freezed,
    Object? model = freezed,
    Object? createdAt = null,
  }) {
    return _then(
      _$MessageInfoImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        role: null == role
            ? _value.role
            : role // ignore: cast_nullable_to_non_nullable
                  as String,
        content: freezed == content
            ? _value.content
            : content // ignore: cast_nullable_to_non_nullable
                  as String?,
        toolCalls: freezed == toolCalls
            ? _value.toolCalls
            : toolCalls // ignore: cast_nullable_to_non_nullable
                  as dynamic,
        toolResults: freezed == toolResults
            ? _value.toolResults
            : toolResults // ignore: cast_nullable_to_non_nullable
                  as dynamic,
        model: freezed == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String?,
        createdAt: null == createdAt
            ? _value.createdAt
            : createdAt // ignore: cast_nullable_to_non_nullable
                  as String,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$MessageInfoImpl implements _MessageInfo {
  const _$MessageInfoImpl({
    required this.id,
    required this.role,
    this.content,
    this.toolCalls,
    this.toolResults,
    this.model,
    required this.createdAt,
  });

  factory _$MessageInfoImpl.fromJson(Map<String, dynamic> json) =>
      _$$MessageInfoImplFromJson(json);

  @override
  final String id;
  @override
  final String role;
  @override
  final String? content;
  @override
  final dynamic toolCalls;
  @override
  final dynamic toolResults;
  @override
  final String? model;
  @override
  final String createdAt;

  @override
  String toString() {
    return 'MessageInfo(id: $id, role: $role, content: $content, toolCalls: $toolCalls, toolResults: $toolResults, model: $model, createdAt: $createdAt)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$MessageInfoImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.role, role) || other.role == role) &&
            (identical(other.content, content) || other.content == content) &&
            const DeepCollectionEquality().equals(other.toolCalls, toolCalls) &&
            const DeepCollectionEquality().equals(
              other.toolResults,
              toolResults,
            ) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.createdAt, createdAt) ||
                other.createdAt == createdAt));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode => Object.hash(
    runtimeType,
    id,
    role,
    content,
    const DeepCollectionEquality().hash(toolCalls),
    const DeepCollectionEquality().hash(toolResults),
    model,
    createdAt,
  );

  /// Create a copy of MessageInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$MessageInfoImplCopyWith<_$MessageInfoImpl> get copyWith =>
      __$$MessageInfoImplCopyWithImpl<_$MessageInfoImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$MessageInfoImplToJson(this);
  }
}

abstract class _MessageInfo implements MessageInfo {
  const factory _MessageInfo({
    required final String id,
    required final String role,
    final String? content,
    final dynamic toolCalls,
    final dynamic toolResults,
    final String? model,
    required final String createdAt,
  }) = _$MessageInfoImpl;

  factory _MessageInfo.fromJson(Map<String, dynamic> json) =
      _$MessageInfoImpl.fromJson;

  @override
  String get id;
  @override
  String get role;
  @override
  String? get content;
  @override
  dynamic get toolCalls;
  @override
  dynamic get toolResults;
  @override
  String? get model;
  @override
  String get createdAt;

  /// Create a copy of MessageInfo
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$MessageInfoImplCopyWith<_$MessageInfoImpl> get copyWith =>
      throw _privateConstructorUsedError;
}

AgentInfo _$AgentInfoFromJson(Map<String, dynamic> json) {
  return _AgentInfo.fromJson(json);
}

/// @nodoc
mixin _$AgentInfo {
  String get id => throw _privateConstructorUsedError;
  String get name => throw _privateConstructorUsedError;
  String? get description => throw _privateConstructorUsedError;
  String? get model => throw _privateConstructorUsedError;
  bool get enabled => throw _privateConstructorUsedError;

  /// Serializes this AgentInfo to a JSON map.
  Map<String, dynamic> toJson() => throw _privateConstructorUsedError;

  /// Create a copy of AgentInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  $AgentInfoCopyWith<AgentInfo> get copyWith =>
      throw _privateConstructorUsedError;
}

/// @nodoc
abstract class $AgentInfoCopyWith<$Res> {
  factory $AgentInfoCopyWith(AgentInfo value, $Res Function(AgentInfo) then) =
      _$AgentInfoCopyWithImpl<$Res, AgentInfo>;
  @useResult
  $Res call({
    String id,
    String name,
    String? description,
    String? model,
    bool enabled,
  });
}

/// @nodoc
class _$AgentInfoCopyWithImpl<$Res, $Val extends AgentInfo>
    implements $AgentInfoCopyWith<$Res> {
  _$AgentInfoCopyWithImpl(this._value, this._then);

  // ignore: unused_field
  final $Val _value;
  // ignore: unused_field
  final $Res Function($Val) _then;

  /// Create a copy of AgentInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? description = freezed,
    Object? model = freezed,
    Object? enabled = null,
  }) {
    return _then(
      _value.copyWith(
            id: null == id
                ? _value.id
                : id // ignore: cast_nullable_to_non_nullable
                      as String,
            name: null == name
                ? _value.name
                : name // ignore: cast_nullable_to_non_nullable
                      as String,
            description: freezed == description
                ? _value.description
                : description // ignore: cast_nullable_to_non_nullable
                      as String?,
            model: freezed == model
                ? _value.model
                : model // ignore: cast_nullable_to_non_nullable
                      as String?,
            enabled: null == enabled
                ? _value.enabled
                : enabled // ignore: cast_nullable_to_non_nullable
                      as bool,
          )
          as $Val,
    );
  }
}

/// @nodoc
abstract class _$$AgentInfoImplCopyWith<$Res>
    implements $AgentInfoCopyWith<$Res> {
  factory _$$AgentInfoImplCopyWith(
    _$AgentInfoImpl value,
    $Res Function(_$AgentInfoImpl) then,
  ) = __$$AgentInfoImplCopyWithImpl<$Res>;
  @override
  @useResult
  $Res call({
    String id,
    String name,
    String? description,
    String? model,
    bool enabled,
  });
}

/// @nodoc
class __$$AgentInfoImplCopyWithImpl<$Res>
    extends _$AgentInfoCopyWithImpl<$Res, _$AgentInfoImpl>
    implements _$$AgentInfoImplCopyWith<$Res> {
  __$$AgentInfoImplCopyWithImpl(
    _$AgentInfoImpl _value,
    $Res Function(_$AgentInfoImpl) _then,
  ) : super(_value, _then);

  /// Create a copy of AgentInfo
  /// with the given fields replaced by the non-null parameter values.
  @pragma('vm:prefer-inline')
  @override
  $Res call({
    Object? id = null,
    Object? name = null,
    Object? description = freezed,
    Object? model = freezed,
    Object? enabled = null,
  }) {
    return _then(
      _$AgentInfoImpl(
        id: null == id
            ? _value.id
            : id // ignore: cast_nullable_to_non_nullable
                  as String,
        name: null == name
            ? _value.name
            : name // ignore: cast_nullable_to_non_nullable
                  as String,
        description: freezed == description
            ? _value.description
            : description // ignore: cast_nullable_to_non_nullable
                  as String?,
        model: freezed == model
            ? _value.model
            : model // ignore: cast_nullable_to_non_nullable
                  as String?,
        enabled: null == enabled
            ? _value.enabled
            : enabled // ignore: cast_nullable_to_non_nullable
                  as bool,
      ),
    );
  }
}

/// @nodoc
@JsonSerializable()
class _$AgentInfoImpl implements _AgentInfo {
  const _$AgentInfoImpl({
    required this.id,
    required this.name,
    this.description,
    this.model,
    required this.enabled,
  });

  factory _$AgentInfoImpl.fromJson(Map<String, dynamic> json) =>
      _$$AgentInfoImplFromJson(json);

  @override
  final String id;
  @override
  final String name;
  @override
  final String? description;
  @override
  final String? model;
  @override
  final bool enabled;

  @override
  String toString() {
    return 'AgentInfo(id: $id, name: $name, description: $description, model: $model, enabled: $enabled)';
  }

  @override
  bool operator ==(Object other) {
    return identical(this, other) ||
        (other.runtimeType == runtimeType &&
            other is _$AgentInfoImpl &&
            (identical(other.id, id) || other.id == id) &&
            (identical(other.name, name) || other.name == name) &&
            (identical(other.description, description) ||
                other.description == description) &&
            (identical(other.model, model) || other.model == model) &&
            (identical(other.enabled, enabled) || other.enabled == enabled));
  }

  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  int get hashCode =>
      Object.hash(runtimeType, id, name, description, model, enabled);

  /// Create a copy of AgentInfo
  /// with the given fields replaced by the non-null parameter values.
  @JsonKey(includeFromJson: false, includeToJson: false)
  @override
  @pragma('vm:prefer-inline')
  _$$AgentInfoImplCopyWith<_$AgentInfoImpl> get copyWith =>
      __$$AgentInfoImplCopyWithImpl<_$AgentInfoImpl>(this, _$identity);

  @override
  Map<String, dynamic> toJson() {
    return _$$AgentInfoImplToJson(this);
  }
}

abstract class _AgentInfo implements AgentInfo {
  const factory _AgentInfo({
    required final String id,
    required final String name,
    final String? description,
    final String? model,
    required final bool enabled,
  }) = _$AgentInfoImpl;

  factory _AgentInfo.fromJson(Map<String, dynamic> json) =
      _$AgentInfoImpl.fromJson;

  @override
  String get id;
  @override
  String get name;
  @override
  String? get description;
  @override
  String? get model;
  @override
  bool get enabled;

  /// Create a copy of AgentInfo
  /// with the given fields replaced by the non-null parameter values.
  @override
  @JsonKey(includeFromJson: false, includeToJson: false)
  _$$AgentInfoImplCopyWith<_$AgentInfoImpl> get copyWith =>
      throw _privateConstructorUsedError;
}
