import React from 'react';
import { c } from '../../brand/tokens';

// A few quiet architectural lines are enough to place the two hands at home.
export const Kitchen: React.FC = () => (
  <svg viewBox="0 0 1920 1080" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
    <g fill="none" stroke={c.borderControl} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
      <path d="M1430 170 H1758 V470 H1430 Z M1594 170 V470 M1430 320 H1758" />
      <path d="M96 832 H1824 M174 847 H1746" stroke={c.text} strokeWidth={6} />
      <path d="M1454 726 H1534 V789 Q1534 806 1516 806 H1472 Q1454 806 1454 789 Z" fill={c.surface} stroke={c.text} strokeWidth={6} />
      <path d="M1535 742 H1548 Q1576 742 1576 766 Q1576 790 1535 783" stroke={c.text} strokeWidth={6} />
      <path d="M1494 704 C1474 686 1512 674 1494 650" stroke={c.muted} />
    </g>
  </svg>
);
