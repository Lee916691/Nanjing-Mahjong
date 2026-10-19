export function SoundToggle({ muted, onToggle }: { muted: boolean; onToggle: () => void }) {
  return (
    <button className="sound-toggle" aria-pressed={!muted} onClick={onToggle}>
      音效：{muted ? '已静音' : '已开启'}
    </button>
  );
}
