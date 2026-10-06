import React, { useState, useRef, useEffect } from 'react';
import { DDRAGON_VERSION } from '../config';

/**
 * HextechOverlay
 * ----------------
 * A League of Legends "Hextech" styled in-game overlay that replicates the
 * composition of the reference design (image_0.png). It is rendered on top of
 * the transparent Electron window so the game shows through the gaps between
 * panels.
 *
 * All data is mock/demo data driven by the `OverlayData` shape below. Any field
 * that is not yet wired to the live backend simply falls back to these mocks.
 */

// ----------------------------------------------------------------------------
// Hextech style tokens
// ----------------------------------------------------------------------------
const COLORS = {
  goldLight: '#C8AA6E',
  goldDark: '#785A28',
  teal: '#00BBA3',
  crimson: '#EE2345',
  blue: '#0397AB',
  blueBar: '#2A93D5',
  redBar: '#C6443E',
  textGold: '#F0E6D2',
  textMuted: '#A09B8C',
  obsidian: '#010A13',
  slate: '#091428',
};

const GOLD_GRADIENT = `linear-gradient(135deg, ${COLORS.goldLight} 0%, ${COLORS.goldDark} 100%)`;
const TEAL_GRADIENT = `linear-gradient(135deg, #2DE2C9 0%, ${COLORS.teal} 100%)`;
const PANEL_GRADIENT = `linear-gradient(160deg, rgba(1, 10, 19, 0.78) 0%, rgba(9, 20, 40, 0.78) 100%)`;

const SERIF = "'Cinzel', serif";
const SANS = "'Barlow', sans-serif";

// 45-degree chamfer on the top-left and bottom-right corners (classic Hextech).
const chamfer = (c: number) =>
  `polygon(${c}px 0, 100% 0, 100% calc(100% - ${c}px), calc(100% - ${c}px) 100%, 0 100%, 0 ${c}px)`;

// ----------------------------------------------------------------------------
// Mock data
// ----------------------------------------------------------------------------
export interface OverlayData {
  scaling: {
    bluePercent: number;
    redPercent: number;
    blueBars: number[];
    redBars: number[];
    phase: string;
    advantageTeam: string;
    windowTime: string;
  };
  tempo: {
    csPerMin: number;
    goldPerMin: number;
    totalCs: number;
    totalGold: number;
    gameTime: string;
  };
  duel: {
    enemy: string;
    winPct: number;
    result: string;
    ultStatus: string;
    mitigation: string;
  };
  itemGuide: {
    championName: string;
    currentGold: number;
    buildPath: { id: number; name: string; owned: boolean }[];
    nextBuy: {
      item_name: string;
      item_id: number;
      gold_needed: number;
      is_completed_item: boolean;
    } | null;
  };
}

const MOCK_DATA: OverlayData = {
  scaling: {
    bluePercent: 60,
    redPercent: 40,
    blueBars: [32, 41, 50, 58, 67, 78, 92],
    redBars: [90, 80, 70, 61, 52, 44, 36],
    phase: 'Early Midgame',
    advantageTeam: 'Blue',
    windowTime: '28:00',
  },
  tempo: {
    csPerMin: 7.8,
    goldPerMin: 412,
    totalCs: 218,
    totalGold: 11540,
    gameTime: '28:00',
  },
  duel: {
    enemy: 'Zed',
    winPct: 64,
    result: 'ADVANTAGE (YELLOW)',
    ultStatus: 'DOWN',
    mitigation: 'Armor Active',
  },
  itemGuide: {
    championName: 'Jinx',
    currentGold: 1450,
    buildPath: [
      { id: 6672, name: 'Kraken Slayer', owned: true },
      { id: 3031, name: 'Infinity Edge', owned: false },
      { id: 3094, name: 'Rapid Firecannon', owned: false },
    ],
    nextBuy: {
      item_name: 'B.F. Sword',
      item_id: 1038,
      gold_needed: 0,
      is_completed_item: false,
    },
  },
};

// ----------------------------------------------------------------------------
// Reusable chamfered panel with a 1.5px gold (or teal) border.
// ----------------------------------------------------------------------------
interface HexPanelProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  chamferSize?: number;
  clip?: string;
  accent?: 'gold' | 'teal';
  glow?: boolean;
}

const HexPanel = ({
  children,
  style,
  chamferSize = 14,
  clip,
  accent = 'gold',
  glow = false,
}: HexPanelProps) => {
  const cp = clip || chamfer(chamferSize);
  const borderGradient = accent === 'teal' ? TEAL_GRADIENT : GOLD_GRADIENT;
  return (
    <div
      style={{
        clipPath: cp,
        background: borderGradient,
        padding: '1.5px',
        boxShadow: glow
          ? `0 0 14px 2px rgba(0, 187, 163, 0.85), 0 0 4px rgba(0, 187, 163, 0.9)`
          : '0 6px 18px rgba(0, 0, 0, 0.55)',
        pointerEvents: 'auto',
        ...style,
      }}
    >
      <div
        style={{
          clipPath: cp,
          background: PANEL_GRADIENT,
          backdropFilter: 'blur(2px)',
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
        }}
      >
        {children}
      </div>
    </div>
  );
};

// Section heading like "[ HEXTECH SCALING ]"
const PanelTitle = ({ children }: { children: React.ReactNode }) => (
  <div
    style={{
      fontFamily: SERIF,
      fontWeight: 700,
      fontSize: '13px',
      letterSpacing: '1.5px',
      color: COLORS.goldLight,
      textAlign: 'center',
      textShadow: '0 0 6px rgba(200, 170, 110, 0.4)',
      marginBottom: '10px',
    }}
  >
    [ {children} ]
  </div>
);

// ----------------------------------------------------------------------------
// Panel: Farm & Economy tempo (top-left) — CS/min and Gold/min counters.
// ----------------------------------------------------------------------------
// A single big stat: large gold gradient number with a unit + label beneath.
const TempoStat = ({ value, unit, label }: { value: string; unit: string; label: string }) => (
  <div style={{ flex: 1, textAlign: 'center' }}>
    <div
      style={{
        fontFamily: SERIF,
        fontWeight: 700,
        fontSize: '34px',
        lineHeight: 1,
        background: GOLD_GRADIENT,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textShadow: '0 0 10px rgba(200, 170, 110, 0.25)',
      }}
    >
      {value}
    </div>
    <div
      style={{
        fontFamily: SANS,
        fontSize: '9px',
        letterSpacing: '2px',
        color: COLORS.textMuted,
        marginTop: '5px',
      }}
    >
      {unit}
    </div>
    <div
      style={{
        fontFamily: SERIF,
        fontWeight: 700,
        fontSize: '12px',
        letterSpacing: '1.5px',
        color: COLORS.goldLight,
        marginTop: '3px',
      }}
    >
      {label}
    </div>
  </div>
);

const TempoPanel = ({ data }: { data: OverlayData['tempo'] }) => (
  <HexPanel style={{ width: '250px' }}>
    <div style={{ padding: '14px 16px 16px' }}>
      <PanelTitle>FARM & ECONOMY</PanelTitle>

      {/* CS/min and Gold/min headline counters */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '10px',
          paddingBottom: '12px',
          borderBottom: `1px solid rgba(200, 170, 110, 0.25)`,
        }}
      >
        <TempoStat value={data.csPerMin.toFixed(1)} unit="PER MIN" label="CS" />
        <div style={{ width: '1px', alignSelf: 'stretch', background: 'rgba(200, 170, 110, 0.25)' }} />
        <TempoStat value={Math.round(data.goldPerMin).toString()} unit="PER MIN" label="GOLD" />
      </div>

      {/* Totals footer */}
      <div
        style={{
          marginTop: '10px',
          fontFamily: SANS,
          fontSize: '12px',
          color: COLORS.textMuted,
          lineHeight: '1.9',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Total CS:</span>
          <span style={{ color: COLORS.textGold, fontWeight: 600 }}>{data.totalCs}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Total Gold Earned:</span>
          <span style={{ color: COLORS.textGold, fontWeight: 600 }}>
            {data.totalGold.toLocaleString()}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Game Time:</span>
          <span style={{ color: COLORS.goldLight, fontWeight: 600 }}>{data.gameTime}</span>
        </div>
      </div>
    </div>
  </HexPanel>
);

// ----------------------------------------------------------------------------
// Panel: 1v1 Engagement (left-center)
// ----------------------------------------------------------------------------
const DuelPanel = ({ data }: { data: OverlayData['duel'] }) => (
  <HexPanel style={{ width: '250px' }}>
    <div style={{ padding: '14px 16px 16px' }}>
      <PanelTitle>1v1 ENGAGEMENT VS {data.enemy.toUpperCase()}</PanelTitle>

      {/* Donut */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '6px 0 14px' }}>
        <div
          style={{
            position: 'relative',
            width: '120px',
            height: '120px',
            borderRadius: '50%',
            background: `conic-gradient(${COLORS.crimson} 0deg 90deg, #1FCF6A 90deg 250deg, #F0C040 250deg 360deg)`,
            boxShadow: '0 0 10px rgba(0,0,0,0.5)',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '16px',
              borderRadius: '50%',
              background: COLORS.obsidian,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                fontFamily: SERIF,
                fontSize: '14px',
                fontWeight: 700,
                color: '#1FCF6A',
                letterSpacing: '2px',
              }}
            >
              WIN
            </span>
            <span
              style={{
                fontFamily: SANS,
                fontSize: '34px',
                fontWeight: 700,
                color: COLORS.textGold,
                lineHeight: 1,
              }}
            >
              {data.winPct}%
            </span>
          </div>
        </div>
      </div>

      <div style={{ fontFamily: SANS, fontSize: '12px', color: COLORS.textMuted, lineHeight: '1.8' }}>
        <div>
          Result:{' '}
          <span style={{ color: '#F0C040', fontWeight: 700 }}>{data.result}</span>
        </div>
        <div>
          {data.enemy} Ult:{' '}
          <span style={{ color: COLORS.crimson, fontWeight: 700 }}>[{data.ultStatus}]</span>
        </div>
        <div>
          Stat Mitigation:{' '}
          <span style={{ color: COLORS.textGold, fontWeight: 600 }}>{data.mitigation}</span>
        </div>
      </div>
    </div>
  </HexPanel>
);

// ----------------------------------------------------------------------------
// Panel: Item Progression Guide (live build tracker)
// ----------------------------------------------------------------------------
// Data Dragon item icons. Version is pinned to match the app's patch data.
const itemIcon = (id: number) =>
  `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/item/${id}.png`;

const ItemGuidePanel = ({ data }: { data: OverlayData['itemGuide'] }) => {
  const { nextBuy, buildPath, currentGold } = data;
  // Green when the recommendation is already affordable, red when the player
  // still needs to farm more gold.
  const affordable = !nextBuy || nextBuy.gold_needed <= 0;
  const goldColor = affordable ? COLORS.teal : COLORS.crimson;

  return (
    <HexPanel style={{ width: '250px' }}>
      <div style={{ padding: '14px 16px 16px' }}>
        <PanelTitle>ITEM PROGRESSION</PanelTitle>

        {/* Core build checklist */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '12px' }}>
          {buildPath.length === 0 && (
            <div
              style={{
                fontFamily: SANS,
                fontSize: '12px',
                color: COLORS.textMuted,
                textAlign: 'center',
                padding: '6px 0',
              }}
            >
              No build path for {data.championName || 'this champion'} yet.
            </div>
          )}
          {buildPath.map((item) => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                opacity: item.owned ? 1 : 0.55,
              }}
            >
              <img
                src={itemIcon(item.id)}
                alt={item.name}
                width={28}
                height={28}
                style={{
                  border: `1px solid ${item.owned ? COLORS.teal : COLORS.goldDark}`,
                  borderRadius: '2px',
                  filter: item.owned ? 'none' : 'grayscale(0.6)',
                }}
              />
              <span
                style={{
                  fontFamily: SANS,
                  fontSize: '13px',
                  color: item.owned ? COLORS.textGold : COLORS.textMuted,
                  flex: 1,
                }}
              >
                {item.name}
              </span>
              <span style={{ color: item.owned ? COLORS.teal : COLORS.textMuted, fontSize: '14px' }}>
                {item.owned ? '\u2714' : '\u25CB'}
              </span>
            </div>
          ))}
        </div>

        {/* Next purchase card */}
        <div
          style={{
            borderTop: `1px solid rgba(200, 170, 110, 0.25)`,
            paddingTop: '12px',
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: '11px',
              letterSpacing: '2px',
              color: COLORS.textMuted,
              textAlign: 'center',
              marginBottom: '8px',
            }}
          >
            NEXT PURCHASE
          </div>

          {nextBuy ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img
                src={itemIcon(nextBuy.item_id)}
                alt={nextBuy.item_name}
                width={40}
                height={40}
                style={{ border: `1.5px solid ${goldColor}`, borderRadius: '3px' }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: SANS, fontSize: '14px', fontWeight: 700, color: COLORS.textGold }}>
                  {nextBuy.item_name}
                </div>
                <div style={{ fontFamily: SANS, fontSize: '12px', color: goldColor, fontWeight: 600 }}>
                  {affordable ? (
                    nextBuy.is_completed_item ? 'Ready to complete!' : 'Ready to buy!'
                  ) : (
                    <>Need {nextBuy.gold_needed.toLocaleString()}g more</>
                  )}
                </div>
                <div style={{ fontFamily: SANS, fontSize: '11px', color: COLORS.textMuted }}>
                  Gold: {currentGold.toLocaleString()}
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                fontFamily: SANS,
                fontSize: '13px',
                color: COLORS.teal,
                textAlign: 'center',
                fontWeight: 600,
              }}
            >
              Core build complete!
            </div>
          )}
        </div>
      </div>
    </HexPanel>
  );
};

// ----------------------------------------------------------------------------
// Interactivity helpers
// ----------------------------------------------------------------------------
// Toggle Electron window click-through. In the in-game overlay the window is
// click-through by default so clicks reach the game; these calls temporarily
// capture the mouse while the user interacts with a panel. No-ops in a plain
// browser (Vite preview) where `window.electronAPI` is undefined.
const captureMouse = () => window.electronAPI?.setMouseIgnore(false);
const releaseMouse = () => window.electronAPI?.setMouseIgnore(true);

// Small control button (drag handle / close) shown above each panel.
const controlBtnStyle: React.CSSProperties = {
  width: '22px',
  height: '22px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  fontSize: '13px',
  lineHeight: 1,
  color: COLORS.goldLight,
  background: 'rgba(1, 10, 19, 0.85)',
  border: `1px solid ${COLORS.goldDark}`,
  cursor: 'pointer',
  fontFamily: SANS,
};

// ----------------------------------------------------------------------------
// DraggablePanel: wraps a panel so the user can move it around or dismiss it.
// ----------------------------------------------------------------------------
// Default placement is expressed as CSS anchors (top/left/right/bottom) so it
// is correct at ANY screen resolution. Only once the user drags a panel do we
// switch to absolute x/y pixel coordinates.
type PanelAnchor = {
  top?: number;
  left?: number | string;
  right?: number;
  bottom?: number;
  transform?: string;
};

interface DraggablePanelProps {
  panelKey: string;
  anchor: PanelAnchor;
  onClose: (key: string) => void;
  children: React.ReactNode;
}

const DraggablePanel = ({ panelKey, anchor, onClose, children }: DraggablePanelProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  // null -> use the CSS anchor default; once dragged -> fixed pixel position.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  // Ref-based drag state avoids stale closures inside window listeners.
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const onMove = (e: MouseEvent) => {
    if (!drag.current) return;
    setPos({
      x: Math.max(0, drag.current.ox + (e.clientX - drag.current.sx)),
      y: Math.max(0, drag.current.oy + (e.clientY - drag.current.sy)),
    });
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', endDrag);
    // If the pointer ended outside the panel, restore click-through.
    releaseMouse();
  };

  const beginDrag = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Seed the drag origin from the current on-screen position. When still on
    // the CSS anchor, read the live rect so the panel doesn't jump.
    const rect = wrapperRef.current?.getBoundingClientRect();
    const ox = pos ? pos.x : rect?.left ?? 0;
    const oy = pos ? pos.y : rect?.top ?? 0;
    drag.current = { sx: e.clientX, sy: e.clientY, ox, oy };
    captureMouse(); // keep the window interactive for the whole drag
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', endDrag);
  };

  // Remove listeners if the panel unmounts mid-drag. IMPORTANT: do NOT call
  // releaseMouse() here — during a POST_MATCH -> PRE_MATCH transition the panels
  // unmount, and a late setMouseIgnore(true) would make the dashboard window
  // click-through (appearing to "disappear"). setOverlayMode owns that state.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', endDrag);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const positionStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { ...anchor };

  return (
    <div
      ref={wrapperRef}
      style={{ position: 'absolute', pointerEvents: 'auto', ...positionStyle }}
      // Capture the mouse while hovering so buttons/drag work; release on leave
      // so clicks fall through to the game again (unless mid-drag).
      onMouseEnter={captureMouse}
      onMouseLeave={() => {
        if (!drag.current) releaseMouse();
      }}
    >
      {/* Control strip: drag handle + dismiss button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px', marginBottom: '4px' }}>
        <button
          type="button"
          title="Drag to move"
          onMouseDown={beginDrag}
          style={{ ...controlBtnStyle, cursor: 'move' }}
        >
          {'\u271A'}
        </button>
        <button
          type="button"
          title="Hide panel"
          onClick={() => onClose(panelKey)}
          style={controlBtnStyle}
        >
          {'\u2715'}
        </button>
      </div>
      {children}
    </div>
  );
};

// ----------------------------------------------------------------------------
// Overlay root: positions every panel over the transparent game window.
// Each panel can be dragged or dismissed; a Reset control restores them.
// ----------------------------------------------------------------------------
interface HextechOverlayProps {
  data?: Partial<OverlayData>;
}

const HextechOverlay = ({ data }: HextechOverlayProps) => {
  const d: OverlayData = {
    scaling: { ...MOCK_DATA.scaling, ...(data?.scaling ?? {}) },
    tempo: { ...MOCK_DATA.tempo, ...(data?.tempo ?? {}) },
    duel: { ...MOCK_DATA.duel, ...(data?.duel ?? {}) },
    itemGuide: { ...MOCK_DATA.itemGuide, ...(data?.itemGuide ?? {}) },
  };

  // Which panels the user has dismissed.
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  // Bumping this remounts every DraggablePanel, resetting positions.
  const [resetToken, setResetToken] = useState(0);

  // Default CSS anchors mirroring the original layout. Resolution-independent:
  // right/bottom/centered anchors stay correct on any monitor size.
  const anchors: Record<string, PanelAnchor> = {
    tempo: { top: 20, left: 20 },
    duel: { top: 285, left: 20 },
    itemGuide: { top: 150, right: 20 },
  };

  const closePanel = (key: string) => setHidden((h) => ({ ...h, [key]: true }));
  const resetAll = () => {
    setHidden({});
    setResetToken((t) => t + 1);
  };

  const panels: { key: string; node: React.ReactNode }[] = [
    { key: 'tempo', node: <TempoPanel data={d.tempo} /> },
    { key: 'duel', node: <DuelPanel data={d.duel} /> },
    { key: 'itemGuide', node: <ItemGuidePanel data={d.itemGuide} /> },
  ];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        pointerEvents: 'none', // gaps are click-through; panels re-enable pointer events
      }}
    >
      {/* Reset control: restore all dismissed/moved panels. */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '50%',
          transform: 'translateX(-50%)',
          pointerEvents: 'auto',
        }}
        onMouseEnter={captureMouse}
        onMouseLeave={releaseMouse}
      >
        <button
          type="button"
          title="Reset overlay layout"
          onClick={resetAll}
          style={{
            ...controlBtnStyle,
            width: 'auto',
            height: '22px',
            padding: '0 10px',
            fontSize: '11px',
            letterSpacing: '1px',
            fontFamily: SERIF,
          }}
        >
          RESET
        </button>
      </div>

      {panels
        .filter((p) => !hidden[p.key])
        .map((p) => (
          <DraggablePanel
            key={`${p.key}-${resetToken}`}
            panelKey={p.key}
            anchor={anchors[p.key]}
            onClose={closePanel}
          >
            {p.node}
          </DraggablePanel>
        ))}
    </div>
  );
};

export default HextechOverlay;
