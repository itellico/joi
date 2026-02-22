import SwiftUI
import AppIntents

@main
struct JOIWatchExtensionApp: App {
    @State private var sessionClient = WatchSessionClient()

    var body: some Scene {
        WindowGroup {
            WatchHomeView()
                .environment(sessionClient)
        }
    }
}
