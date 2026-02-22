import Foundation
import SwiftData

@Model
final class Conversation {
    @Attribute(.unique) var id: String
    var title: String?
    var agentId: String
    var lastMessage: String?
    var updatedAt: Date

    @Relationship(deleteRule: .cascade, inverse: \Message.conversation)
    var messages: [Message] = []

    init(id: String, title: String? = nil, agentId: String = "default", lastMessage: String? = nil, updatedAt: Date = .now) {
        self.id = id
        self.title = title
        self.agentId = agentId
        self.lastMessage = lastMessage
        self.updatedAt = updatedAt
    }
}

@Model
final class Message {
    @Attribute(.unique) var id: String
    var conversation: Conversation?
    var role: String
    var content: String
    var model: String?
    var createdAt: Date

    init(id: String, role: String, content: String, model: String? = nil, createdAt: Date = .now) {
        self.id = id
        self.role = role
        self.content = content
        self.model = model
        self.createdAt = createdAt
    }
}

@Model
final class AppSetting {
    @Attribute(.unique) var key: String
    var value: String

    init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}
