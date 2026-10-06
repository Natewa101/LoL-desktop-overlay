import React from 'react';

/**
 * AppLayoutWrapper
 * -----------------
 * A global reusable layout wrapper that encloses every top-level view
 * (Pre-Game / Champion Select / Post-Game / in-game overlay). It injects a
 * thin, invisible header strip along the top edge that acts as the window
 * dragging handle for the frameless Electron window.
 *
 * The drag behaviour is driven entirely by CSS (`-webkit-app-region: drag`)
 * applied to `.global-app-drag-handle` in `index.css`. Interactive elements
 * inside the app should carry `-webkit-app-region: no-drag` (see the
 * `.no-drag` helper class) so buttons/inputs remain clickable.
 */
interface AppLayoutWrapperProps {
  children: React.ReactNode;
  /**
   * Whether the drag handle is active. It should only be enabled in the
   * PRE_MATCH dashboard view. During the POST_MATCH fullscreen in-game overlay
   * the handle is hidden so it never intercepts in-game mouse input.
   */
  showDragHandle?: boolean;
}

const AppLayoutWrapper = ({ children, showDragHandle = true }: AppLayoutWrapperProps) => {
  return (
    <div className="global-app-layout">
      {/* Invisible dragging handle pinned to the top edge of the window.
          Rendered only in PRE_MATCH so it cannot steal in-game clicks. */}
      {showDragHandle && <div className="global-app-drag-handle" />}
      {children}
    </div>
  );
};

export default AppLayoutWrapper;
