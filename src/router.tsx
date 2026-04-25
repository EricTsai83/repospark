import {
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from 'react-router-dom';
import { AppLayout, LandingRoute, ProtectedLayout } from '@/router-layouts';

async function loadChatRoute() {
  const module = await import('@/pages/chat');
  return { Component: module.ChatPage };
}

export const appRoutes: RouteObject[] = [
  {
    path: '/',
    Component: AppLayout,
    children: [
      {
        index: true,
        Component: LandingRoute,
      },
      {
        Component: ProtectedLayout,
        children: [
          // `/chat` is the no-selection workspace entry point. ChatPage redirects
          // it to the most recent thread (`/t/:threadId`) when one exists, or
          // renders the dual-CTA empty state when none does. Per PRD #19 user
          // story 27 ("most recent thread loads on landing").
          {
            path: 'chat',
            lazy: loadChatRoute,
          },
          // PRD #19 user story 25: stable, shareable URLs for design threads.
          {
            path: 't/:threadId',
            lazy: loadChatRoute,
          },
          // PRD #19 user story 26: stable, shareable URLs for repository overviews
          // (artifacts + threads grounded in that repo).
          {
            path: 'r/:repoId',
            lazy: loadChatRoute,
          },
        ],
      },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}

export function createAppMemoryRouter(initialEntries: string[] = ['/']) {
  return createMemoryRouter(appRoutes, { initialEntries });
}
