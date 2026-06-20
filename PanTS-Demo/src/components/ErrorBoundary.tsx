import { Component, type ReactNode } from "react";

type Props = { fallback: ReactNode; children: ReactNode };
type State = { hasError: boolean };

// Minimal error boundary: if a child throws while rendering (e.g. the three.js
// loader fails to get a WebGL context, or a lazy chunk fails to load), show the
// fallback instead of crashing the subtree to a blank/white canvas.
export default class ErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(): State {
		return { hasError: true };
	}

	componentDidCatch(error: unknown) {
		console.error("ErrorBoundary caught:", error);
	}

	render() {
		return this.state.hasError ? this.props.fallback : this.props.children;
	}
}
