import {
  Button,
  Card,
  Input,
  Select,
  Field,
  PageHeader,
} from '../../design-system';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useProfile, usePutProfile } from '../../api/client';
import type { Profile as ProfileData } from '../../contracts/api';
import { DataStatus } from '../../components/charts';
import './profile.css';
function ProfileForm({ initial }: { initial: ProfileData }) {
  const [value, setValue] = useState(initial),
    [saved, setSaved] = useState(false);
  const mutation = usePutProfile();
  const field = (key: keyof ProfileData, next: string) => {
    setValue((v) => ({ ...v, [key]: next }));
    setSaved(false);
    mutation.reset();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    mutation.mutate(value, { onSuccess: () => setSaved(true) });
  };
  return (
    <Card as="form" className="profile-form" onSubmit={submit}>
      <Input
        label="Pseudonym"
        autoComplete="nickname"
        value={value.pseudonym}
        onChange={(e) => field('pseudonym', e.target.value)}
      />
      <Select
        label="Affected hand"
        value={value.affected_hand}
        onChange={(e) => field('affected_hand', e.target.value)}
      >
        <option value="left">Left</option>
        <option value="right">Right</option>
      </Select>
      <Input
        label="Condition"
        value={value.condition}
        onChange={(e) => field('condition', e.target.value)}
      />
      <Field label="Goals">
        {(ids) => (
          <textarea
            {...ids}
            className="ds-input"
            rows={3}
            value={value.goals}
            onChange={(e) => field('goals', e.target.value)}
          />
        )}
      </Field>
      <Input
        label="Therapist name"
        autoComplete="off"
        value={value.therapist_name}
        onChange={(e) => field('therapist_name', e.target.value)}
      />
      <Input
        label="Therapist email"
        type="email"
        autoComplete="off"
        value={value.therapist_email}
        onChange={(e) => field('therapist_email', e.target.value)}
      />
      <Button type="submit" variant="primary" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save profile'}
      </Button>
      <p role="status">
        {saved
          ? 'Profile saved.'
          : mutation.isError
            ? 'Could not save your profile. Please try again.'
            : ''}
      </p>
    </Card>
  );
}
export default function Profile() {
  const profile = useProfile();
  return (
    <section className="data-page">
      <PageHeader
        title="Profile"
        lead="These optional details personalize your coach and doctor view."
      />
      <p>
        Review hand calibration before your next practice.{' '}
        <Link to="/calibrate">Review calibration</Link>.
      </p>
      <DataStatus loading={profile.isPending} error={profile.error}>
        {profile.data && <ProfileForm initial={profile.data} />}
      </DataStatus>
    </section>
  );
}
