import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "./components/Layout";
import { DaneView } from "./views/DaneView";
import { OknoView } from "./views/OknoView";
import { OkazjeView } from "./views/OkazjeView";
import { ModeleView } from "./views/ModeleView";
import { LiveView } from "./views/LiveView";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/dane" replace /> },
      { path: "live", element: <LiveView /> },
      { path: "dane", element: <DaneView /> },
      { path: "okno", element: <OknoView /> },
      { path: "okno/:pairId/:windowId", element: <OknoView /> },
      { path: "okazje", element: <OkazjeView /> },
      { path: "okazje/:pairId/:windowId", element: <OkazjeView /> },
      { path: "modele", element: <ModeleView /> },
    ],
  },
]);
