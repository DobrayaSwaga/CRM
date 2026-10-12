import { useState } from 'react';
import { LogIn, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../auth';
import { Button, Input } from '../components/ui';
import EyeLogo from '../components/EyeLogo';

export default function Login() {
  const { login } = useAuth();
  const [loginStr, setLoginStr] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(loginStr, password);
    } catch (err: any) {
      setError(err.message || 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex items-center justify-center p-4">
      <div className="app-bg">
        <div className="blob w-[600px] h-[600px] -top-52 -left-52" style={{ background: '#4338ca' }} />
        <div className="blob w-[500px] h-[500px] -bottom-40 -right-40" style={{ background: '#7c3aed', animationDelay: '-5s' }} />
      </div>

      <div className="glass-strong rounded-3xl p-10 w-full max-w-sm animate-slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="mb-4" style={{ filter: 'drop-shadow(0 8px 28px rgba(124, 58, 237, 0.4))' }}>
            <EyeLogo size={72} />
          </div>
          <h1 className="text-2xl font-bold glow-text">NexusCRM</h1>
          <p className="text-slate-500 text-sm mt-1">Система приёмной комиссии</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <Input
              autoFocus
              placeholder="Логин"
              value={loginStr}
              onChange={e => setLoginStr(e.target.value)}
            />
          </div>
          <div className="relative">
            <Input
              type={showPass ? 'text' : 'password'}
              placeholder="Пароль"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {error && (
            <div className="text-red-300 text-xs bg-red-500/10 border border-red-400/25 rounded-xl px-3 py-2 animate-fade-in">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={busy || !loginStr || !password}>
            <LogIn size={16} />
            {busy ? 'Входим…' : 'Войти'}
          </Button>
        </form>
      </div>
    </div>
  );
}
