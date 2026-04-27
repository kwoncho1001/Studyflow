import {StrictMode, Component, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AlertCircle } from 'lucide-react';

class TopLevelErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: any }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black flex flex-col items-center justify-center p-8 text-center text-white">
          <AlertCircle className="text-red-500 mb-4" size={48} />
          <h1 className="text-2xl font-bold mb-2">시스템 오류</h1>
          <p className="text-zinc-500 mb-6">애플리케이션을 로드하는 중 심각한 오류가 발생했습니다.</p>
          <pre className="bg-zinc-900 p-4 rounded-xl text-xs text-red-400 max-w-full overflow-auto mb-8">
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-white text-black font-bold rounded-xl"
          >
            다시 시도
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TopLevelErrorBoundary>
      <App />
    </TopLevelErrorBoundary>
  </StrictMode>,
);
