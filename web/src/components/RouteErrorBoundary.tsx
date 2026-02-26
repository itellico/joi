import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

interface Props {
  title: string;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class RouteErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[RouteErrorBoundary:${this.props.title}]`, error, info);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="card" style={{ margin: "var(--space-4)", maxWidth: 820 }}>
        <h3 className="m-0 mb-2">{this.props.title} crashed</h3>
        <p className="text-secondary m-0 mb-3">
          A runtime error occurred while rendering this page. Please reload and try again.
        </p>
        <pre className="reviews-code-block reviews-code-block--full">
          {this.state.error.message}
        </pre>
        <div className="mt-3">
          <Button onClick={() => window.location.reload()}>Reload Page</Button>
        </div>
      </div>
    );
  }
}

