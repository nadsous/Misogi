import { Component, type ReactNode } from "react";

/**
 * Filet de sécurité : si un écran plante (donnée inattendue dans le journal…), on affiche un message
 * et un bouton pour revenir, au lieu d'une fenêtre blanche qu'il faudrait relancer.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; onReset: () => void; label: { title: string; back: string } }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Misogi :", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium">{this.props.label.title}</p>
        <p className="max-w-full truncate font-mono text-2xs text-faint">{this.state.error.message}</p>
        <button
          autoFocus
          onClick={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
          className="rounded-md border border-line px-3 py-1.5 text-xs hover:bg-raised"
        >
          {this.props.label.back}
        </button>
      </div>
    );
  }
}
