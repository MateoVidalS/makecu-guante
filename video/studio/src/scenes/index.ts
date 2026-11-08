import type React from 'react';
import type { SceneId } from '../timeline';
import { Build } from './Build';
import { Close } from './Close';
import { Coach } from './Coach';
import { Doctor } from './Doctor';
import { Gemini } from './Gemini';
import { Hook } from './Hook';
import { Next } from './Next';
import { Problem } from './Problem';
import { Reveal } from './Reveal';
import { Session } from './Session';
import { Team } from './Team';
import { UnderHood } from './UnderHood';

export const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  hook: Hook,
  team: Team,
  problem: Problem,
  reveal: Reveal,
  session: Session,
  coach: Coach,
  gemini: Gemini,
  doctor: Doctor,
  build: Build,
  underHood: UnderHood,
  next: Next,
  close: Close,
};
