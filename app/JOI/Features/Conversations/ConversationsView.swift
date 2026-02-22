import SwiftUI

struct ConversationsView: View {
    @Environment(WebSocketClient.self) private var webSocket
    @Environment(FrameRouter.self) private var router
    @Binding var selectedConversationId: String?

    var body: some View {
        List(selection: $selectedConversationId) {
            ForEach(router.sessionList) { session in
                NavigationLink(value: session.id) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.title ?? "Untitled")
                            .font(JOITypography.bodyMedium)
                            .foregroundStyle(JOIColors.textPrimary)
                            .lineLimit(1)

                        if let lastMessage = session.lastMessage {
                            Text(lastMessage)
                                .font(JOITypography.bodySmall)
                                .foregroundStyle(JOIColors.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(JOIColors.surface)
        .toolbar {
            ToolbarItem(placement: .automatic) {
                Button(action: newConversation) {
                    Image(systemName: "plus")
                }
            }
        }
        .onAppear {
            webSocket.send(type: .sessionList)
        }
        .navigationTitle("Conversations")
    }

    private func newConversation() {
        selectedConversationId = nil
    }
}
