import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INSPECTOR_TABS,
  MORE_INSPECTOR_TABS,
  PRIMARY_INSPECTOR_TABS,
  inspectorTabAfterKey,
  primaryInspectorTabAfterKey,
  rememberInspectorTab,
} from './InspectorPanel';
import type { InspectorTab } from './types';

const source = readFileSync('src/domains/nodeslide/inspector/InspectorPanel.tsx', 'utf8');

describe('NodeSlide inspector shell state', () => {
  it('keeps the authoring/review grouping that orders every tab', () => {
    expect(INSPECTOR_TABS.map(({ id }) => id)).toEqual([
      'ai',
      'design',
      'nodebook',
      'comments',
      'versions',
      'data',
      'json',
      'trace',
    ]);
    expect(INSPECTOR_TABS.filter(({ group }) => group === 'author').map(({ id }) => id)).toEqual([
      'ai',
      'design',
    ]);
    // The divider is decorative and must never enter the tablist's roving focus.
    expect(source).toContain('aria-hidden="true"');
  });

  it('keeps five high-frequency views on the narrow rail and preserves NodeBook in More', () => {
    expect(PRIMARY_INSPECTOR_TABS.map(({ label }) => label)).toEqual([
      'AI',
      'Design',
      'Comments',
      'Evidence',
      'Trace',
    ]);
    expect(MORE_INSPECTOR_TABS.map(({ label }) => label)).toEqual(['NodeBook', 'Versions', 'JSON']);
    expect(source).toContain('data-testid="inspector-more"');
    expect(source).toContain('<DropdownMenuContent');
    expect(source).toContain('<DropdownMenuItem');
    // The overflow trigger only exists below the drawer breakpoint.
    expect(source).toContain('useViewportMatch(NODESLIDE_RESPONSIVE_DRAWER_QUERY)');
    expect(source).toContain('drawerViewport ? PRIMARY_INSPECTOR_TABS : INSPECTOR_TABS');
  });

  it('implements automatic, wrapping roving focus for the five primary tabs', () => {
    expect(primaryInspectorTabAfterKey('ai', 'ArrowLeft')).toBe('trace');
    expect(primaryInspectorTabAfterKey('trace', 'ArrowRight')).toBe('ai');
    expect(primaryInspectorTabAfterKey('comments', 'Home')).toBe('ai');
    expect(primaryInspectorTabAfterKey('comments', 'End')).toBe('trace');
    expect(primaryInspectorTabAfterKey('comments', 'Enter')).toBeNull();
  });

  it('implements automatic, wrapping roving focus for all inspector tabs', () => {
    expect(inspectorTabAfterKey('ai', 'ArrowLeft')).toBe('trace');
    expect(inspectorTabAfterKey('trace', 'ArrowRight')).toBe('ai');
    expect(inspectorTabAfterKey('comments', 'Home')).toBe('ai');
    expect(inspectorTabAfterKey('comments', 'End')).toBe('trace');
    expect(inspectorTabAfterKey('comments', 'Enter')).toBeNull();
  });

  /**
   * Wiring guard. `rememberInspectorTab` is only worth anything if the panel it records is
   * the panel that stays mounted; a version that keeps the set and still unmounts on switch
   * would pass a pure unit test and lose the user's draft anyway.
   */
  it('retains every visited tab so switching does not destroy drafts', () => {
    const mounted = new Set<InspectorTab>();

    rememberInspectorTab(mounted, 'ai');
    rememberInspectorTab(mounted, 'comments');
    rememberInspectorTab(mounted, 'ai');

    expect([...mounted]).toEqual(['ai', 'comments']);
    expect(source).toContain('rememberInspectorTab(mountedTabsRef.current, activeTab)');
    expect(source).toContain("mountedTabsRef.current.has('ai')");
    expect(source).toContain("mountedTabsRef.current.has('json')");
    expect(source).toContain('hidden={activeTab !== id}');
    // The old single-panel wrapper keyed off activeTab; if it comes back, retention is gone.
    expect(source).not.toContain("{activeTab === 'ai' ? (");
  });

  /** Keyboard navigation must come from the exported helpers, not re-derived index maths. */
  it('drives tab keyboard navigation through the exported helpers', () => {
    expect(source).toContain('primaryInspectorTabAfterKey(currentTab, event.key)');
    expect(source).toContain('inspectorTabAfterKey(currentTab, event.key)');
  });
});
