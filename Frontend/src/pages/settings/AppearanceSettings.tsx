import { Monitor, Moon, Sun } from 'lucide-react';
import { useSession } from '@/api/auth';
import { useUpdatePreferences } from '@/api/settings';
import { Label, NativeSelect } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Switch } from '@/components/ui/misc';
import { usePageMeta } from '@/hooks/usePageMeta';
import { useTheme, type ThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEMES: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

export default function AppearanceSettings() {
  usePageMeta('Appearance', [{ label: 'Settings', to: '/settings' }]);
  const { preference, setPreference } = useTheme();
  const { data } = useSession();
  const prefs = data?.user?.preferences;
  const update = useUpdatePreferences();

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Theme</CardTitle>
          <CardDescription>“System” follows your device’s light/dark setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label="Theme" className="grid max-w-md grid-cols-3 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={preference === t.value}
                onClick={() => {
                  setPreference(t.value);
                  update.mutate({ theme: t.value });
                }}
                className={cn(
                  'border-border hover:bg-hover flex flex-col items-center gap-2 rounded-lg border p-4 text-sm',
                  preference === t.value && 'border-accent bg-primary/10 text-accent',
                )}
              >
                <t.icon className="size-5" aria-hidden />
                {t.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Editor</CardTitle>
        </CardHeader>
        <CardContent className="grid max-w-md gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="font-size">Font size</Label>
            <NativeSelect
              id="font-size"
              className="w-28"
              value={prefs?.editorFontSize ?? 14}
              onChange={(e) => update.mutate({ editorFontSize: Number(e.target.value) })}
            >
              {[12, 13, 14, 15, 16, 18, 20].map((s) => (
                <option key={s} value={s}>
                  {s}px
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="line-wrap">Wrap long lines</Label>
            <Switch
              id="line-wrap"
              checked={prefs?.editorLineWrap ?? true}
              onCheckedChange={(v) => update.mutate({ editorLineWrap: v })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
