abstract final class FrameTypes {
  // Client → Gateway
  static const chatSend = 'chat.send';
  static const sessionList = 'session.list';
  static const sessionLoad = 'session.load';
  static const sessionCreate = 'session.create';
  static const agentList = 'agent.list';
  static const systemPing = 'system.ping';

  // Gateway → Client
  static const chatStream = 'chat.stream';
  static const chatDone = 'chat.done';
  static const chatError = 'chat.error';
  static const chatToolUse = 'chat.tool_use';
  static const chatToolResult = 'chat.tool_result';
  static const sessionData = 'session.data';
  static const agentData = 'agent.data';
  static const systemStatus = 'system.status';
  static const systemPong = 'system.pong';
}
