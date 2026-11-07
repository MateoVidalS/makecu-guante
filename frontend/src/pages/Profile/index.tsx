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
    <form className="profile-form card" onSubmit={submit}>
      <label>
        Pseudonym
        <input
          autoComplete="nickname"
          value={value.pseudonym}
          onChange={(e) => field('pseudonym', e.target.value)}
        />
      </label>
      <label>
        Affected hand
        <select
          value={value.affected_hand}
          onChange={(e) => field('affected_hand', e.target.value)}
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
      </label>
      <label>
        Condition
        <input
          value={value.condition}
          onChange={(e) => field('condition', e.target.value)}
        />
      </label>
      <label>
        Goals
        <textarea
          rows={3}
          value={value.goals}
          onChange={(e) => field('goals', e.target.value)}
        />
      </label>
      <label>
        Therapist name
        <input
          autoComplete="off"
          value={value.therapist_name}
          onChange={(e) => field('therapist_name', e.target.value)}
        />
      </label>
      <label>
        Therapist email
        <input
          type="email"
          autoComplete="off"
          value={value.therapist_email}
          onChange={(e) => field('therapist_email', e.target.value)}
        />
      </label>
      <button className="primary" disabled={mutation.isPending}>
        {mutation.isPending ? 'Saving…' : 'Save profile'}
      </button>
      <p role="status">
        {saved
          ? 'Profile saved.'
          : mutation.isError
            ? 'Could not save your profile. Please try again.'
            : ''}
      </p>
    </form>
  );
}
export default function Profile() {
  const profile = useProfile();
  return (
    <section className="data-page">
      <h1>Profile</h1>
      <p>These optional details personalize your coach and doctor view.</p>
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
