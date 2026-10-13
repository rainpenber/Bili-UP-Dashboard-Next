import { RouterProvider } from 'react-router-dom';
import { appRouter } from '@/routes/router';

export function App() {
  return <RouterProvider router={appRouter} />;
}
