import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

part 'database.g.dart';

// ─── Tables ───

class Conversations extends Table {
  TextColumn get id => text()();
  TextColumn get title => text().nullable()();
  TextColumn get agentId => text().withDefault(const Constant('personal'))();
  IntColumn get messageCount => integer().withDefault(const Constant(0))();
  TextColumn get lastMessage => text().nullable()();
  DateTimeColumn get updatedAt =>
      dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}

class Messages extends Table {
  TextColumn get id => text()();
  TextColumn get conversationId =>
      text().references(Conversations, #id)();
  TextColumn get role => text()();
  TextColumn get content => text().nullable()();
  TextColumn get model => text().nullable()();
  TextColumn get toolCalls => text().nullable()();
  IntColumn get inputTokens => integer().nullable()();
  IntColumn get outputTokens => integer().nullable()();
  DateTimeColumn get createdAt =>
      dateTime().withDefault(currentDateAndTime)();

  @override
  Set<Column> get primaryKey => {id};
}

class Settings extends Table {
  TextColumn get key => text()();
  TextColumn get value => text()();

  @override
  Set<Column> get primaryKey => {key};
}

// ─── Database ───

@DriftDatabase(tables: [Conversations, Messages, Settings])
class AppDatabase extends _$AppDatabase {
  AppDatabase._() : super(_openConnection());

  static AppDatabase? _instance;
  static AppDatabase get instance => _instance ??= AppDatabase._();

  @override
  int get schemaVersion => 1;

  // ─── Conversations ───

  Future<List<Conversation>> getAllConversations() =>
      (select(conversations)
            ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
          .get();

  Stream<List<Conversation>> watchAllConversations() =>
      (select(conversations)
            ..orderBy([(t) => OrderingTerm.desc(t.updatedAt)]))
          .watch();

  Future<void> upsertConversation(ConversationsCompanion entry) =>
      into(conversations).insertOnConflictUpdate(entry);

  Future<void> deleteConversation(String id) =>
      (delete(conversations)..where((t) => t.id.equals(id))).go();

  // ─── Messages ───

  Future<List<Message>> getMessagesForConversation(String conversationId) =>
      (select(messages)
            ..where((t) => t.conversationId.equals(conversationId))
            ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]))
          .get();

  Stream<List<Message>> watchMessagesForConversation(
          String conversationId) =>
      (select(messages)
            ..where((t) => t.conversationId.equals(conversationId))
            ..orderBy([(t) => OrderingTerm.asc(t.createdAt)]))
          .watch();

  Future<void> upsertMessage(MessagesCompanion entry) =>
      into(messages).insertOnConflictUpdate(entry);

  // ─── Settings ───

  Future<String?> getSetting(String key) async {
    final row = await (select(settings)..where((t) => t.key.equals(key)))
        .getSingleOrNull();
    return row?.value;
  }

  Future<void> setSetting(String key, String value) =>
      into(settings).insertOnConflictUpdate(
        SettingsCompanion.insert(key: key, value: value),
      );

  Stream<String?> watchSetting(String key) =>
      (select(settings)..where((t) => t.key.equals(key)))
          .watchSingleOrNull()
          .map((row) => row?.value);
}

LazyDatabase _openConnection() {
  return LazyDatabase(() async {
    final dbFolder = await getApplicationSupportDirectory();
    final file = File(p.join(dbFolder.path, 'joi.db'));
    return NativeDatabase.createInBackground(file);
  });
}
