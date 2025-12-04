import { useEffect, useMemo, useState } from 'react';
import { Whiteboard } from './components/Whiteboard';

function randomBoardId() {
  return Math.random().toString(36).slice(2, 10);
}

export function WhiteboardPage() {
  const [boardId, setBoardId] = useState<string>('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let id = params.get('boardId');
    if (!id) {
      id = randomBoardId();
      params.set('boardId', id);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', newUrl);
    }
    setBoardId(id);
  }, []);

  const shareUrl = useMemo(() => {
    return window.location.href;
  }, [boardId]);

  if (!boardId) {
    return null;
  }

  return (
    <div className="page">
      <header className="page-header">
        <div className="title-group">
          <h1>协同白板</h1>
          <p className="subtitle">React + Canvas + WebSocket 在线团队协作白板</p>
        </div>
        <div className="share-group">
          <label className="share-label">分享链接</label>
          <input
            className="share-input"
            value={shareUrl}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
        </div>
      </header>

      <main className="page-main">
        <Whiteboard boardId={boardId} />
      </main>
    </div>
  );
}


