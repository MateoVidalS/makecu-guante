import { Banner, ButtonLink } from '../../design-system';
import {
  calibrationIssueHref,
  type CalibrationIssue,
} from '../../runtime/calibrationValidation';

/** `warning` is the design system's amber caution tone. */
export function CalibrationIssueBanner({
  issue,
}: {
  issue?: CalibrationIssue;
}) {
  if (!issue) return null;
  return (
    <Banner
      tone="warning"
      icon="caution"
      title={issue.message}
      action={
        <ButtonLink size="sm" to={calibrationIssueHref(issue)}>
          Redo {issue.step} range
        </ButtonLink>
      }
    />
  );
}
