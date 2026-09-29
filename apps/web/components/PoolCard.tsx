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
  selectedEntryId,
  onOpenDetail,
  onMoveEntry,
  onSwapEntry,
  onDropEntry,
  onMovePool,
}: {
  pool: PoolDetail;
  editable: boolean;
  selectedEntryId?: string | null;
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
        <span className="pool-card-title" title={pool.poolUid}>
          <span className="pool-card-name">Pool {pool.ordinal}</span>
          <span className="pool-card-count">{pool.members.length} peserta</span>
        </span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {pool.isWalkover ? (
            <StatusBadge quality="YELLOW" title="Pool walkover" />
          ) : (
            <StatusBadge quality={poolQuality(pool)} />
          )}
        </span>
      </div>
      {editable ? (
        <div className="pool-card-tools">
          {/* Deliberately not "Pindahkan ..." (moves the pool's arena/order, a different action from
              moving a participant) -- also avoids colliding with each row's own "Pindahkan" button
              under accessible-name substring matching. */}
          <button type="button" className="btn btn-quiet" onClick={() => setShowMove((s) => !s)}>
            Atur Posisi Pool
          </button>
          {showMove ? (
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              <input
                aria-label="Kode Arena"
                value={arenaCode}
                onChange={(e) => setArenaCode(e.target.value)}
                style={{ width: 56 }}
              />
              <input
                aria-label="Urutan"
                type="number"
                value={order}
                onChange={(e) => setOrder(Number(e.target.value))}
                style={{ width: 56 }}
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
                Terapkan
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {pool.members.length === 0 ? (
        <div className="pool-card-empty">Belum ada peserta</div>
      ) : (
        <div className="pool-card-rows">
          {pool.members.map((m) => (
            <EntryCard
              key={m.entryId}
              entry={m}
              draggable={editable}
              selected={m.entryId === selectedEntryId}
              onOpenDetail={() => onOpenDetail(m)}
              onMove={editable ? () => onMoveEntry(m) : undefined}
              onSwap={editable ? () => onSwapEntry(m) : undefined}
              onDragStart={(e) => e.dataTransfer.setData('text/entry-id', m.entryId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
