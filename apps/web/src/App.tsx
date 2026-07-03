import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type HealthState = 'checking' | 'ok' | 'error';
type SocketState = 'connecting' | 'connected' | 'disconnected' | 'error';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

export function App() {
  const [healthState, setHealthState] = useState<HealthState>('checking');
  const [socketState, setSocketState] = useState<SocketState>('connecting');

  useEffect(() => {
    let isMounted = true;

    fetch(`${apiBaseUrl}/health`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status}`);
        }
        return response.json() as Promise<{ status?: string }>;
      })
      .then((body) => {
        if (isMounted) {
          setHealthState(body.status === 'ok' ? 'ok' : 'error');
        }
      })
      .catch(() => {
        if (isMounted) {
          setHealthState('error');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const socket: Socket = io(apiBaseUrl, {
      transports: ['websocket'],
    });

    socket.on('connect', () => setSocketState('connected'));
    socket.on('connect_error', () => setSocketState('error'));
    socket.on('disconnect', () => setSocketState('disconnected'));

    return () => {
      socket.disconnect();
    };
  }, []);

  const healthLabel = useMemo(() => {
    if (healthState === 'checking') {
      return '检查中';
    }

    return healthState === 'ok' ? '正常' : '不可用';
  }, [healthState]);

  const socketLabel = useMemo(() => {
    const labels: Record<SocketState, string> = {
      connecting: '连接中',
      connected: '已连接',
      disconnected: '已断开',
      error: '连接失败',
    };

    return labels[socketState];
  }, [socketState]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Nanjing Mahjong</p>
          <h1>南京麻将项目已启动</h1>
        </div>
        <div className="status-grid" aria-label="服务状态">
          <article>
            <span>后端健康状态</span>
            <strong data-state={healthState}>{healthLabel}</strong>
          </article>
          <article>
            <span>实时连接</span>
            <strong data-state={socketState}>{socketLabel}</strong>
          </article>
        </div>
      </section>
    </main>
  );
}
