import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ShellLayout } from '@/components/shell/ShellLayout';
import { NotificationProvider } from '@/components/ui/NotificationProvider';
import { EventsProvider } from '@/lib/useEvents';
import { Login } from '@/pages/Login';
import { Studio } from '@/pages/Studio';
import { Gallery } from '@/pages/Gallery';
import { Pabrik } from '@/pages/Pabrik';
import { Admin } from '@/pages/Admin';
import { AdminMonitoring } from '@/pages/AdminMonitoring';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <EventsProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ShellLayout />}>
              <Route path="/" element={<Navigate to="/studio" replace />} />
              <Route path="/studio" element={<Studio />} />
              <Route path="/pabrik" element={<Pabrik />} />
              <Route path="/gallery" element={<Gallery />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/monitoring" element={<AdminMonitoring />} />
            </Route>
            <Route path="*" element={<Navigate to="/studio" replace />} />
          </Routes>
        </EventsProvider>
      </NotificationProvider>
    </BrowserRouter>
  );
};

export default App;

