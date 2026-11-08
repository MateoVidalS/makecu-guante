import React from 'react';
import { c, radius, safe, space, type, weight } from '../../brand/tokens';
import { T } from '../brand';
import { COPY } from '../../script';
import { Card, enter, Icon, type IconName, Line, mono, ToolGrid, Waveform } from './primitives';

const nodes = [
  { x: 96, width: 304, icon: 'voice' },
  { x: 448, width: 300, icon: 'voice' },
  { x: 796, width: 252, icon: 'tools' },
  { x: 1096, width: 340, icon: 'clamp' },
  { x: 1484, width: 340, icon: 'engine' },
] satisfies { x: number; width: number; icon: IconName }[];

export const SpeechFlow: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: safe.x, top: 304, opacity: enter(frame, 0) }}>
      Function calling
    </T>
    {nodes.slice(1).map((node, i) => (
      <Line key={node.x} path={`M ${nodes[i].x + nodes[i].width} 496 L ${node.x} 496`}
        progress={enter(frame, 18 + i * 18)} arrow />
    ))}
    {nodes.map((node, i) => (
      <Card key={node.x} style={{
        left: node.x, top: 400, width: node.width, height: 192,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: space.s24,
        opacity: enter(frame, 6 + i * 18),
      }}>
        {i === 1 ? <Waveform frame={frame} /> : <Icon name={node.icon} />}
        <T size="h3" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{COPY.gemini.flow[i]}</T>
      </Card>
    ))}
  </>
);

export const BoundedCall: React.FC<{ frame: number }> = ({ frame }) => {
  // Expand from the exact Tool call / Runtime clamps positions in the speech flow.
  const expand = enter(frame, 132);
  const dispatch = enter(frame, 168, 18);
  const checked = enter(frame, 186);
  const typed = COPY.gemini.exampleCall.slice(0, Math.floor(enter(frame, 144, 18) * COPY.gemini.exampleCall.length));
  return (
    <>
      <Line path="M 1276 432 L 1324 432" progress={enter(frame, 156)} arrow />
      <Card style={{
        left: 796 + (safe.x - 796) * expand, top: 400 - 64 * expand, width: 252 + 928 * expand,
        height: 192 + space.s32 * expand, overflow: 'hidden',
      }}>
        <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: space.s32, top: space.s32 }}>
          {COPY.gemini.flow[2]}
        </T>
        <div style={{
          position: 'absolute', top: 96, left: space.s32, right: space.s32, padding: `${space.s16}px 0`,
          fontFamily: mono, fontSize: type.body, fontWeight: weight.regular, color: c.text, whiteSpace: 'nowrap',
        }}>
          {typed}<span style={{ opacity: frame < 168 ? 1 : 0, color: c.muted }}>│</span>
        </div>
      </Card>
      <Card style={{
        left: 1096 + 228 * expand, top: 400 - 64 * expand, width: 340 + 160 * expand, height: 192 + space.s32 * expand,
        border: `${frame >= 186 ? 3 : 1}px solid ${frame >= 186 ? c.brand : c.border}`,
        padding: space.s16 + space.s16 * expand, overflow: 'hidden',
      }}>
        <div style={{ display: 'flex', gap: space.s24 * expand, alignItems: 'center' }}>
          <div style={{ width: 48 * expand, overflow: 'hidden', opacity: expand, flexShrink: 0 }}><Icon name="clamp" /></div>
          <T size="h3" style={{ whiteSpace: 'nowrap' }}>{COPY.gemini.flow[3]}</T>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.s16, marginTop: space.s32, opacity: checked }}>
          <T size="small" w={400}>clamped · logged ·</T>
          <div style={{
            background: c.surface, border: `1px solid ${c.borderControl}`, borderRadius: radius.input,
            padding: `${space.s8}px ${space.s24}px`,
          }}><T size="small">Undo</T></div>
        </div>
      </Card>
      {frame >= 168 && frame < 186 && <div style={{
        position: 'absolute', left: 1124 + 292 * dispatch, top: 442, padding: `${space.s16}px ${space.s24}px`,
        border: `1px solid ${c.borderStrong}`, background: c.surface2, borderRadius: radius.input,
        fontFamily: mono, fontSize: type.small, color: c.text, opacity: 1 - enter(frame, 180, 6),
      }}>{COPY.gemini.exampleCall.split('(')[0]}</div>}
      <T size="h3" style={{ position: 'absolute', left: safe.x, top: 624, opacity: enter(frame, 150) }}>
        {COPY.gemini.toolCount}
      </T>
      <ToolGrid tools={COPY.gemini.tools} frame={frame} start={156} style={{ left: safe.x, right: safe.x, top: 692 }} />
    </>
  );
};

export const MotorBoundary: React.FC<{ frame: number }> = ({ frame }) => {
  const cut = enter(frame, 252, 9);
  return (
    <>
      <T size="h3" style={{ position: 'absolute', left: safe.x, top: 304 }}>{COPY.gemini.toolCount}</T>
      <ToolGrid tools={COPY.gemini.tools} frame={frame} start={240} columns={3}
        style={{ left: safe.x, width: 1008, top: 400 }} />
      <Line path={`M 1104 512 L ${1298 - 34 * cut} 512`} progress={1} />
      <Line path={`M ${1298 + 34 * cut} 512 L 1492 512`} progress={1} />
      <div style={{ position: 'absolute', left: 1266, top: 480, width: 64, height: 64, background: c.bg,
        display: 'grid', placeItems: 'center', opacity: cut }}><Icon name="lock" /></div>
      <T size="small" w={400} color={c.muted} style={{ position: 'absolute', left: 1120, top: 584, width: 356, textAlign: 'center', opacity: cut }}>
        No direct motor access
      </T>
      <Card style={{ left: 1492, top: 400, width: 332, height: 224, padding: space.s32,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.s16 }}>
        <Icon name="engine" />
        <T size="body" style={{ whiteSpace: 'nowrap' }}>5 micro servos</T>
        <T size="caption" w={400} color={c.muted}>Beyond the session engine</T>
      </Card>
      <Card style={{ left: safe.x, right: safe.x, top: 752, height: 128, padding: space.s32,
        display: 'flex', gap: space.s32, alignItems: 'center', opacity: enter(frame, 258) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.s16, flexShrink: 0 }}>
          <Icon name="laptop" size={40} />
          <T size="small" color={c.muted} w={400}>on the laptop</T>
        </div>
        <T size="body" w={400}>{COPY.gemini.localRule}</T>
      </Card>
    </>
  );
};

const useIcons: IconName[] = ['voice', 'text', 'chat', 'speaker'];

export const Uses: React.FC<{ frame: number }> = ({ frame }) => (
  <>
    {COPY.gemini.uses.map((use, i) => {
      const progress = enter(frame, 318 + i * 18);
      return (
        <Card key={use.title} style={{
          left: safe.x + i * 438, top: 336, width: 414, height: 492, padding: space.s32,
          border: `${i === 3 ? 3 : 1}px solid ${i === 3 ? c.brand : c.border}`,
          opacity: progress, transform: `translateY(${(1 - progress) * 12}px)`,
        }}>
          <Icon name={useIcons[i]} />
          <T size="h3" style={{ marginTop: space.s48, marginBottom: space.s24 }}>{use.title}</T>
          <T size="body" color={c.muted} w={400}>{use.sub}</T>
        </Card>
      );
    })}
  </>
);
