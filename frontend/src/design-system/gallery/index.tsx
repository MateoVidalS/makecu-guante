import { useState, type ReactNode } from 'react';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DemoBadge,
  DescriptionList,
  Dialog,
  EmptyState,
  Grid,
  Heading,
  Icon,
  IconButton,
  iconNames,
  Inline,
  Input,
  KpiTile,
  Meter,
  PageHeader,
  Pill,
  ProgressRing,
  Select,
  Skeleton,
  Slider,
  Stack,
  StatusChip,
  StatusDot,
  Stepper,
  Switch,
  Tabs,
  Text,
  ThemeSwitch,
  Toast,
  useToast,
  type ButtonVariant,
  type StatusTone,
} from '..';
import { tokens } from '../../styles/tokens';
import { contrast } from '../contrast';
import './gallery.css';

const SECTIONS = [
  ['foundations', 'Foundations'],
  ['buttons', 'Buttons'],
  ['status', 'Status'],
  ['navigation', 'Tabs & stepper'],
  ['forms', 'Forms'],
  ['feedback', 'Feedback'],
  ['data', 'Data'],
  ['patterns', 'Patterns'],
] as const;

function Section({
  id,
  title,
  lead,
  children,
}: {
  id: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="gallery-section"
      aria-labelledby={`${id}-title`}
    >
      <div className="gallery-section__head">
        <Heading level={2} id={`${id}-title`}>
          {title}
        </Heading>
        {lead && <Text tone="muted">{lead}</Text>}
      </div>
      {children}
    </section>
  );
}

function Specimen({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure
      className={`gallery-specimen${wide ? ' gallery-specimen--wide' : ''}`}
    >
      <div className="gallery-specimen__stage">{children}</div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

const COLOR_ROLES: [
  key: keyof typeof tokens.light,
  css: string,
  meaning: string,
][] = [
  ['bg', '--bg', 'Page'],
  ['surface', '--surface', 'Cards'],
  ['surface2', '--surface-2', 'Insets, chart wells'],
  ['border', '--border', 'Hairlines: cards, dividers'],
  ['borderControl', '--border-control', 'Button and pill outlines'],
  ['borderStrong', '--border-strong', 'Input outlines (≥ 3:1)'],
  ['text', '--text', 'Body text'],
  ['muted', '--muted', 'Secondary text'],
  ['accent', '--accent', 'Actions, links, focus'],
  ['target', '--target', 'Target pose (ghost)'],
  ['active', '--active', 'Moving on your own'],
  ['assist', '--assist', 'Glove helping'],
  ['reached', '--reached', 'Reached'],
  ['danger', '--danger', 'Safety only'],
  ['demo', '--demo', 'Demo data'],
  ['caution', '--caution', 'Heads-up (not safety)'],
  ['fingerThumb', '--finger-thumb', 'Thumb series (charts)'],
  ['fingerIndex', '--finger-index', 'Index series (charts)'],
  ['fingerMiddle', '--finger-middle', 'Middle series (charts)'],
];

function Foundations() {
  return (
    <Stack gap={32}>
      <div>
        <Heading level={3}>Color roles</Heading>
        <Text tone="muted" size="small">
          Contrast shown against --surface for light / dark. State fills
          (active, assist, reached) are for bars, dots and the hand; their -text
          variants are for words.
        </Text>
        <div className="gallery-swatches">
          {COLOR_ROLES.map(([key, css, meaning]) => (
            <div key={css} className="gallery-swatch">
              <span
                className="gallery-swatch__chip"
                style={{ background: `var(${css})` }}
              />
              <code>{css}</code>
              <span>{meaning}</span>
              <span className="gallery-swatch__ratio">
                {contrast(tokens.light[key], tokens.light.surface).toFixed(1)} /{' '}
                {contrast(tokens.dark[key], tokens.dark.surface).toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Heading level={3}>
          Type scale · Atkinson Hyperlegible Next, 17 px root, regular +
          semibold
        </Heading>
        <Stack gap={12} className="gallery-type">
          <div>
            <span className="ds-display ds-heading">Make a hook</span>
            <code>display 3rem · patient instruction only</code>
          </div>
          <div>
            <span className="ds-h1 ds-heading">Session complete</span>
            <code>h1 2rem · one per page</code>
          </div>
          <div>
            <span className="ds-h2 ds-heading">Active range over sessions</span>
            <code>h2 1.375rem (1.75rem in the focus shell)</code>
          </div>
          <div>
            <span className="ds-h3 ds-heading">
              Index: closing further on its own
            </span>
            <code>h3 1.125rem (1.375rem in the focus shell)</code>
          </div>
          <div>
            <Text>
              Keep the hand relaxed. Press STOP or say "stop" anytime.
            </Text>
            <code>body 1rem</code>
          </div>
          <div>
            <Text size="small">
              Estimated from the camera — not a medical measurement.
            </Text>
            <code>small 0.875rem</code>
          </div>
          <div>
            <Text size="caption">
              Session date (UTC) · charts and doctor view only
            </Text>
            <code>caption 0.75rem</code>
          </div>
        </Stack>
      </div>
      <Grid min="14rem" gap={24}>
        <div>
          <Heading level={3}>Space (4 px grid)</Heading>
          <Stack gap={4}>
            {[4, 8, 12, 16, 24, 32, 48, 64].map((s) => (
              <div key={s} className="gallery-space">
                <span style={{ width: `var(--space-${s})` }} />
                <code>--space-{s}</code>
              </div>
            ))}
          </Stack>
        </div>
        <div>
          <Heading level={3}>Radii & elevation</Heading>
          <Inline gap={16}>
            <div
              className="gallery-shape"
              style={{ borderRadius: 'var(--radius-sm)' }}
            >
              sm 4
            </div>
            <div
              className="gallery-shape"
              style={{ borderRadius: 'var(--radius-input)' }}
            >
              input 6
            </div>
            <div
              className="gallery-shape"
              style={{
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-card)',
              }}
            >
              card 10
            </div>
            <div
              className="gallery-shape"
              style={{
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--elevation-overlay)',
              }}
            >
              overlay
            </div>
          </Inline>
        </div>
      </Grid>
      <div>
        <Heading level={3}>
          Icons · 24 px grid, 2 px round stroke, currentColor
        </Heading>
        <div className="gallery-icons">
          {iconNames.map((name) => (
            <span key={name} title={name}>
              <Icon name={name} size={24} />
              <code>{name}</code>
            </span>
          ))}
        </div>
      </div>
    </Stack>
  );
}

function Buttons() {
  const variants: ButtonVariant[] = ['primary', 'secondary', 'quiet', 'danger'];
  const [loading, setLoading] = useState(false);
  return (
    <Stack gap={24}>
      {(['lg', 'md', 'sm'] as const).map((size) => (
        <Specimen
          key={size}
          wide
          label={`size="${size}" · ${size === 'lg' ? '64 px, patient views' : size === 'md' ? '48 px, helper & data views' : '36 px, doctor & dense views'}`}
        >
          <Inline gap={12}>
            {variants.map((v) => (
              <Button
                key={v}
                variant={v}
                size={size}
                icon={
                  v === 'primary'
                    ? 'play'
                    : v === 'danger'
                      ? 'trash'
                      : undefined
                }
              >
                {v === 'primary'
                  ? "Start today's practice"
                  : v === 'danger'
                    ? 'Delete session'
                    : v === 'quiet'
                      ? 'Skip pose'
                      : 'Pause'}
              </Button>
            ))}
            <Button size={size} disabled>
              Disabled
            </Button>
          </Inline>
        </Specimen>
      ))}
      <Inline gap={24} align="start">
        <Specimen label="loading (aria-busy)">
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1500);
            }}
          >
            {loading ? 'Saving…' : 'Save calibration'}
          </Button>
        </Specimen>
        <Specimen label="IconButton (always labelled)">
          <Inline gap={8}>
            <IconButton icon="x" label="Close" />
            <IconButton icon="refresh" label="Retry" variant="secondary" />
            <IconButton icon="print" label="Print" size="sm" />
          </Inline>
        </Specimen>
        <Specimen label="iconAfter">
          <Button iconAfter="arrow-right" variant="primary">
            Next finger
          </Button>
        </Specimen>
      </Inline>
    </Stack>
  );
}

function Status() {
  const tones: StatusTone[] = [
    'neutral',
    'info',
    'active',
    'assist',
    'reached',
    'danger',
    'demo',
    'caution',
    'off',
  ];
  return (
    <Stack gap={24}>
      <Specimen
        wide
        label="StatusChip — header & Setup (dot + word, never color alone)"
      >
        <Inline gap={8}>
          <StatusChip tone="reached" icon="glove" label="Glove" value="Ready" />
          <StatusChip
            tone="assist"
            icon="glove"
            label="Glove"
            value="Helping"
            pulse
          />
          <StatusChip
            tone="danger"
            icon="glove"
            label="Glove"
            value="Stopped"
          />
          <StatusChip
            tone="off"
            icon="glove"
            label="Glove"
            value="Not connected"
          />
          <StatusChip
            tone="reached"
            icon="camera"
            label="Camera"
            value="Sees hand"
          />
          <StatusChip
            tone="caution"
            icon="camera-off"
            label="Camera"
            value="Can't see hand"
          />
          <StatusChip
            tone="demo"
            icon="monitor"
            label="Glove"
            value="Simulator"
          />
        </Inline>
      </Specimen>
      <Specimen wide label="Badge — static labels">
        <Inline gap={8}>
          {tones.map((t) => (
            <Badge key={t} tone={t}>
              {t}
            </Badge>
          ))}
          <DemoBadge />
          <Badge tone="caution" icon="caution">
            Aborted at 30%
          </Badge>
          <Badge tone="info">Estimate</Badge>
        </Inline>
      </Specimen>
      <Specimen wide label="StatusDot">
        <Inline gap={16}>
          {tones.map((t) => (
            <Inline key={t} gap={8}>
              <StatusDot tone={t} />{' '}
              <Text as="span" size="small">
                {t}
              </Text>
            </Inline>
          ))}
        </Inline>
      </Specimen>
      <PillDemo />
    </Stack>
  );
}

function PillDemo() {
  const [preset, setPreset] = useState('tendon');
  return (
    <Specimen wide label="Pill — choose a preset (aria-pressed)">
      <Inline gap={8}>
        {[
          ['tendon', 'Tendon glides'],
          ['pinch', 'Pinch practice'],
          ['short', 'Short session'],
        ].map(([id, label]) => (
          <Pill key={id} selected={preset === id} onClick={() => setPreset(id)}>
            {label}
          </Pill>
        ))}
      </Inline>
    </Specimen>
  );
}

function Navigation() {
  const steps = [
    { id: 'glove', label: 'Glove range' },
    { id: 'camera', label: 'Camera range' },
    { id: 'friction', label: 'Glove friction' },
    { id: 'review', label: 'Review' },
  ];
  const [step, setStep] = useState('camera');
  const doneUpTo = steps.findIndex((s) => s.id === step);
  return (
    <Stack gap={32}>
      <Tabs
        label="History views"
        items={[
          {
            id: 'overview',
            label: 'Overview',
            content: <Text>Overview panel. Use ← → to move between tabs.</Text>,
          },
          {
            id: 'range',
            label: 'Active range',
            content: <Text>Active range panel.</Text>,
          },
          {
            id: 'assist',
            label: 'Assistance',
            content: <Text>Assistance panel.</Text>,
          },
          {
            id: 'resistance',
            label: 'Resistance',
            content: <Text>Resistance panel.</Text>,
          },
          {
            id: 'sessions',
            label: 'Sessions',
            content: <Text>Sessions panel.</Text>,
          },
        ]}
      />
      <Stack gap={12}>
        <Stepper
          steps={steps}
          current={step}
          completed={steps.slice(0, doneUpTo).map((s) => s.id)}
          onSelect={setStep}
          label="Calibration steps"
        />
        <Inline gap={8}>
          <Button
            size="sm"
            icon="arrow-left"
            disabled={doneUpTo === 0}
            onClick={() => setStep(steps[doneUpTo - 1].id)}
          >
            Back
          </Button>
          <Button
            size="sm"
            variant="primary"
            iconAfter="arrow-right"
            disabled={doneUpTo === steps.length - 1}
            onClick={() => setStep(steps[doneUpTo + 1].id)}
          >
            Next
          </Button>
        </Inline>
      </Stack>
    </Stack>
  );
}

function Forms() {
  const [angle, setAngle] = useState(95);
  const [mirror, setMirror] = useState(true);
  const [reps, setReps] = useState('3');
  return (
    <Grid min="20rem" gap={32}>
      <Stack gap={16}>
        <Input
          label="Pseudonym"
          hint="Shown in the doctor view. No real names."
          placeholder="e.g. Alex"
        />
        <Input
          label="Repetitions"
          type="number"
          value={reps}
          onChange={(e) => setReps(e.target.value)}
          suffix="reps"
          error={
            Number(reps) > 10
              ? 'Choose 10 or fewer to avoid tiring the hand.'
              : undefined
          }
          min={1}
        />
        <Select
          label="Affected hand"
          options={[
            { value: 'right', label: 'Right' },
            { value: 'left', label: 'Left' },
          ]}
        />
        <Select
          label="Camera"
          layout="inline"
          options={[{ value: 'default', label: 'Default camera' }]}
        />
      </Stack>
      <Stack gap={16}>
        <Slider
          label="Servo angle"
          hint="Move gently. Stop if it hurts."
          min={0}
          max={180}
          value={angle}
          onValueChange={setAngle}
          format={(v) => `${v}°`}
        />
        <Inline gap={8}>
          {[-5, -1, 1, 5].map((d) => (
            <Button
              key={d}
              size="md"
              onClick={() => setAngle((a) => Math.min(180, Math.max(0, a + d)))}
            >
              {d > 0 ? `+${d}°` : `−${Math.abs(d)}°`}
            </Button>
          ))}
        </Inline>
        <Switch
          label="Mirror preview"
          hint="Shows the camera like a mirror."
          checked={mirror}
          onCheckedChange={setMirror}
        />
        <Checkbox label="Observation only (no glove help)" />
        <Checkbox size="lg" label="Hand relaxed in the glove" defaultChecked />
        <Checkbox size="lg" label="Glove connected" disabled />
      </Stack>
    </Grid>
  );
}

function Feedback() {
  const { toast } = useToast();
  const [dialog, setDialog] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [safety, setSafety] = useState(false);
  return (
    <Stack gap={24}>
      <Banner tone="info">Your progress stays here if you leave.</Banner>
      <Banner tone="warning" title="Keep the hand relaxed.">
        Press STOP or say "stop" anytime.
      </Banner>
      <Banner tone="warning" onDismiss={() => undefined}>
        Live coach unavailable — using simple voice.
      </Banner>
      <Banner tone="demo" title="Simulator">
        Practice without hardware. Simulated readings are estimates.
      </Banner>
      {safety ? (
        <div className="gallery-bleed">
          <Banner
            tone="safety"
            title="Stopped — I felt resistance in your index."
            action={
              <Button size="lg" icon="play" onClick={() => setSafety(false)}>
                Resume
              </Button>
            }
            details="Overcurrent on index: 512 mA (limit 450 mA) at 5.5 s. The glove released."
          />
        </div>
      ) : (
        <Specimen
          wide
          label="Safety banner — red, full width, focus moves to Resume"
        >
          <Button
            variant="secondary"
            icon="safety"
            onClick={() => setSafety(true)}
          >
            Show safety banner
          </Button>
        </Specimen>
      )}
      <Inline gap={12}>
        <Button
          onClick={() =>
            toast({
              title: 'Calibration saved',
              description: 'Thumb, index and middle are ready.',
              tone: 'reached',
            })
          }
        >
          Toast: saved
        </Button>
        <Button
          onClick={() =>
            toast({ title: 'Camera reconnected', tone: 'neutral' })
          }
        >
          Toast: info
        </Button>
        <Button
          onClick={() =>
            toast({
              title: 'Live coach unavailable',
              description: 'Using simple voice.',
              tone: 'caution',
            })
          }
        >
          Toast: caution
        </Button>
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
          Delete session…
        </Button>
      </Inline>
      <Inline gap={16} align="start">
        <Toast
          title="Index 55% on your own"
          description="The glove helped with the rest."
          tone="assist"
        />
        <Toast title="You did that on your own." tone="reached" />
      </Inline>
      <Dialog
        open={dialog}
        onClose={() => setDialog(false)}
        title="End this session?"
        description="Your attempts so far are saved."
        footer={
          <>
            <Button data-autofocus onClick={() => setDialog(false)}>
              Keep practicing
            </Button>
            <Button variant="primary" onClick={() => setDialog(false)}>
              End session
            </Button>
          </>
        }
      />
      <ConfirmDialog
        open={confirm}
        title="Delete this session?"
        description="Its attempts and transcript are removed. This cannot be undone."
        confirmLabel="Delete session"
        confirmVariant="danger"
        onConfirm={() => setConfirm(false)}
        onCancel={() => setConfirm(false)}
      />
    </Stack>
  );
}

function Data() {
  return (
    <Stack gap={24}>
      <Grid min="12rem" gap={16}>
        <KpiTile label="Sessions" value="8" icon="calendar" />
        <KpiTile
          label="On your own · index"
          value="55"
          unit="%"
          delta={15}
          deltaLabel="vs last time"
        />
        <KpiTile
          label="Glove help · index"
          value="10"
          unit="%"
          delta={-6}
          better="down"
          deltaLabel="vs last time"
        />
        <KpiTile
          label="Resistance · thumb"
          value="—"
          unit="mA"
          hint="No evaluation yet"
          demo
        />
      </Grid>
      <Grid min="18rem" gap={24}>
        <Card title="Meters" description="role=meter with a value text">
          <Stack gap={16}>
            <Meter
              label="Index on your own"
              value={0.55}
              valueText="55%"
              tone="active"
              target={1}
            />
            <Meter
              label="Middle"
              value={0.9}
              valueText="60% + 30% help"
              segments={[
                { value: 0.6, tone: 'active', label: 'On your own 60%' },
                { value: 0.3, tone: 'assist', label: 'Glove helped 30%' },
              ]}
              target={1}
            />
            <Meter
              label="Current"
              value={120}
              max={600}
              limit={400}
              valueText="120 mA"
              tone="neutral"
              size="sm"
            />
          </Stack>
        </Card>
        <Card
          title="Progress rings"
          description="Phase ring base: calm fill, label inside"
        >
          <Inline gap={24}>
            <ProgressRing value={0.65} label="Try now" tone="active">
              <Icon name="hand" size={28} />
            </ProgressRing>
            <ProgressRing
              value={0.3}
              label="The glove is helping"
              tone="assist"
            >
              <Icon name="glove" size={28} />
            </ProgressRing>
            <ProgressRing value={1} label="Hold it" tone="reached">
              <Icon name="check" size={28} />
            </ProgressRing>
            <ProgressRing label="Show me your hand" tone="neutral">
              <Icon name="camera" size={28} />
            </ProgressRing>
          </Inline>
        </Card>
      </Grid>
      <Grid min="18rem" gap={24}>
        <EmptyState
          icon="history"
          title="No sessions yet"
          action={
            <Button variant="primary" icon="play">
              Start today's practice
            </Button>
          }
        >
          Your progress appears here after your first practice.
        </EmptyState>
        <Card title="Loading" description="Skeletons keep the layout still">
          <Skeleton height={120} radius="var(--radius-input)" />
          <Skeleton lines={3} />
        </Card>
        <Card title="Patient profile">
          <DescriptionList
            items={[
              { label: 'Affected hand', value: 'Right' },
              {
                label: 'Condition',
                value: (
                  <Text as="span" tone="muted">
                    Not provided
                  </Text>
                ),
              },
              {
                label: 'Therapist',
                value: (
                  <Text as="span" tone="muted">
                    Not provided
                  </Text>
                ),
              },
            ]}
          />
        </Card>
      </Grid>
    </Stack>
  );
}

function Patterns() {
  return (
    <Stack gap={24}>
      <Card tone="inset" padding="lg">
        <PageHeader
          eyebrow="Setup / data shell"
          title="Connect glove and camera"
          lead="Two steps. It takes about a minute."
          actions={
            <Button variant="primary" iconAfter="arrow-right">
              Continue to calibration
            </Button>
          }
        />
        <Grid columns={2} gap={24}>
          <Card
            title="Glove"
            actions={<StatusChip tone="reached" label="Glove" value="Ready" />}
            footer={
              <>
                <Button icon="usb">Reconnect</Button>
                <Button variant="quiet">Release glove</Button>
              </>
            }
          >
            <Text>Connected over USB. Firmware 1.2.</Text>
          </Card>
          <Card
            title="Camera"
            actions={
              <StatusChip
                tone="caution"
                label="Camera"
                value="Can't see hand"
              />
            }
          >
            <Text>Move your hand into the frame.</Text>
          </Card>
        </Grid>
      </Card>
      <Card tone="inset" padding="lg">
        <div className="gallery-focus-demo">
          <div className="gallery-focus-demo__hand">
            <Icon name="hand" size={120} />
          </div>
          <Stack gap={16} align="center">
            <ProgressRing value={0.4} size={120} thickness={10} label="Try now">
              <strong className="ds-h3">Try now</strong>
            </ProgressRing>
          </Stack>
        </div>
        <Heading level={3} size="display" className="gallery-instruction">
          Make a hook
        </Heading>
        <Text size="lead" tone="muted" className="gallery-instruction">
          Bend the top two joints
        </Text>
        <Inline gap={12} justify="center">
          <Button size="lg" icon="pause">
            Pause
          </Button>
          <Button size="lg" variant="quiet" icon="skip">
            Skip pose
          </Button>
        </Inline>
      </Card>
    </Stack>
  );
}

/** Living design-system gallery at /_dev/design. Every primitive, state and theme. */
export default function DesignGallery() {
  return (
    <div className="gallery">
      <PageHeader
        eyebrow="Developer"
        title="Design system"
        lead="Every primitive and state in both themes. Docs: docs/design/DESIGN_SYSTEM.md"
        actions={<ThemeSwitch />}
      />
      <nav className="gallery-toc" aria-label="Gallery sections">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`}>
            {label}
          </a>
        ))}
      </nav>
      <Section
        id="foundations"
        title="Foundations"
        lead="Tokens from src/styles/tokens.css. Same color, same meaning everywhere."
      >
        <Foundations />
      </Section>
      <Section
        id="buttons"
        title="Buttons"
        lead="One primary per view. Danger only for destructive confirmations."
      >
        <Buttons />
      </Section>
      <Section
        id="status"
        title="Status"
        lead="Dot + word. Color is never the only signal."
      >
        <Status />
      </Section>
      <Section id="navigation" title="Tabs & stepper">
        <Navigation />
      </Section>
      <Section
        id="forms"
        title="Forms"
        lead="Labels above, hints under the label, errors say how to fix."
      >
        <Forms />
      </Section>
      <Section
        id="feedback"
        title="Feedback"
        lead="Safety is loud; everything else is quiet."
      >
        <Feedback />
      </Section>
      <Section id="data" title="Data">
        <Data />
      </Section>
      <Section
        id="patterns"
        title="Patterns"
        lead="How the primitives compose into the setup and focus shells."
      >
        <Patterns />
      </Section>
    </div>
  );
}
