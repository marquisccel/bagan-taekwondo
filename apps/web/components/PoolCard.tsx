'use client';

import { useState } from 'react';

import type { EntryDisplay, PoolDetail } from '../lib/api';
import { StatusBadge } from './StatusBadge';
import { EntryCard } from './EntryCard';

function poolQuality(p: PoolDetail): 'GREEN' | 'YELLOW' {
  return p.isWalkover || p.explanation.length > 0 ? 'YELLOW' : 'GREEN';
}

export function PoolCard({
  pool,
  editable,
  onOpenDetail,
  onMoveEntry,
  onSwapEntry,
  onDropEntry,
  onMovePool,
}: {
  pool: PoolDetail;
  editable: boolean;
  onOpenDetail: (e: EntryDisplay) => void;
  onMoveEntry: (e: EntryDisplay) => void;
  onSwapEntry: (e: EntryDisplay) => void;
  onDropEntry: (entryId: string, toPoolUid: string) => void;
  onMovePool: (poolUid: string, toArenaCode: string, toOrder: number) => void;
}) {
  const [over, setOver] = useState(false);
  const [showMove, setShowMove] = useState(false);
  const [arenaCode, setArenaCode] = useState('A');
  const [order, setOrder] = useState(1);

  return (
    <div
      className={`pool-card${over ? ' drop-target' : ''}`}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!editable) return;
        e.preventDefault();
        setOver(false);
        const entryId = e.dataTransfer.getData('text/entry-id');
        if (entryId) onDropEntry(entryId, pool.poolUid);
      }}
    >
      <div className="pool-card-header">
        <span>{pool.poolUid}</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {pool.isWalkover ? (
            <StatusBadge quality="YELLOW" title="Walkover pool" />
          ) : (
            <StatusBadge quality={poolQuality(pool)} />
          )}
        </span>
      </div>
      {editable ? (
        <div style={{ padding: '4px 12px' }}>
          <button
            type="button"
            className="btn"
            style={{ fontSize: 11, padding: '2px 8px' }}
            onClick={() => setShowMove((s) => !s)}
          >
            Move pool…
          </button>
          {showMove ? (
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <input
                aria-label="Arena code"
                value={arenaCode}
                onChange={(e) => setArenaCode(e.target.value)}
                style={{ width: 50 }}
              />
              <input
                aria-label="Order"
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                style={{ width: 50 }}
              />
              <button
                type="button"
                className="btn btn-primary"
                style={{ fontSize: 11 }}
                onClick={() => {
                  onMovePool(pool.poolUid, arenaCode, order);
                  setShowMove(false);
                }}
              >
                Go
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {pool.members.length === 0 ? (
        <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12 }}>Empty</div>
      ) : (
        pool.members.map((m) => (
          <EntryCard
            key={m.entryId}
            entry={m}
            draggable={editable}
            onOpenDetail={() => onOpenDetail(m)}
            onMove={editable ? () => onMoveEntry(m) : undefined}
            onSwap={editable ? () => onSwapEntry(m) : undefined}
            onDragStart={(e) => e.dataTransfer.setData('text/entry-id', m.entryId)}
          />
        ))
      )}
    </div>
  );
}
