import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from './auth';
import Layout from './components/Layout';
import { Spinner } from './components/ui';
import BootScreen from './components/BootScreen';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Contacts from './pages/Contacts';
import ContactDetail from './pages/ContactDetail';
import Kanban from './pages/Kanban';
import Tasks from './pages/Tasks';
import CalendarPage from './pages/Calendar';
import Dod from './pages/Dod';
import ImportPage from './pages/Import';
import Duplicates from './pages/Duplicates';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

export default function App() {
  const { user, loading } = useAuth();
  // Экран загрузки: показывается при каждом открытии приложения (F5)
  // и заново после каждого входа (событие nexus:login из auth).
  const [boot, setBoot] = useState<number | null>(() => Date.now());

  useEffect(() => {
    const onLogin = () => setBoot(Date.now());
    window.addEventListener('nexus:login', onLogin);
    return () => window.removeEventListener('nexus:login', onLogin);
  }, []);

  return (
    <>
      {loading ? (
        <div className="h-screen flex items-center justify-center">
          <div className="app-bg">
            <div className="blob w-[500px] h-[500px] -top-40 -left-40" style={{ background: '#4338ca' }} />
          </div>
          <Spinner />
        </div>
      ) : !user ? (
        <Login />
      ) : (
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="contacts" element={<Contacts />} />
            <Route path="contacts/:id" element={<ContactDetail />} />
            <Route path="kanban" element={<Kanban />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="dod" element={<Dod />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="duplicates" element={<Duplicates />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
      {boot !== null && <BootScreen key={boot} onDone={() => setBoot(null)} />}
    </>
  );
}
