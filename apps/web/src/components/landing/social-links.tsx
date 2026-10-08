// Fill in a profile URL to show it in the footer; empty entries are hidden.
export const socialProfiles: { name: string; url: string }[] = [
  { name: 'Instagram', url: '' },
  { name: 'X', url: '' },
  { name: 'TikTok', url: '' },
  { name: 'LinkedIn', url: '' },
];

export function SocialLinks() {
  const profiles = socialProfiles.filter((profile) => profile.url);
  if (profiles.length === 0) return null;
  return (
    <ul className="lp-social" aria-label="Follow Acticlaim">
      {profiles.map(({ name, url }) => (
        <li key={name}>
          <a href={url} target="_blank" rel="noopener noreferrer">
            {name}
          </a>
        </li>
      ))}
    </ul>
  );
}
