import type React from 'react';
import type { SceneId } from '../timeline';
import { Bench } from './Bench';
import { Build } from './Build';
import { Close } from './Close';
import { Coach } from './Coach';
import { Doctor } from './Doctor';
import { Gemini } from './Gemini';
import { Hook } from './Hook';
import { Problem } from './Problem';
import { Reveal } from './Reveal';
import { SessionRemapped } from './SessionRemapped';
import { Team } from './Team';
import { UnderHood } from './UnderHood';

export const SCENE_COMPONENTS: Record<SceneId, React.FC> = {
  hook: Hook,
  team: Team,
  problem: Problem,
  reveal: Reveal,
  session: SessionRemapped,
  coach: Coach,
  gemini: Gemini,
  doctor: Doctor,
  build: Build,
  bench: Bench,
  underHood: UnderHood,
  close: Close,
};
