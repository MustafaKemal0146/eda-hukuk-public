// axe-core koşucusu (KK-P05-5): WCAG 2.x A/AA kuralları; kritik ve ciddi ihlaller döner.
import axe from 'axe-core';

export type AxeIssue = { id: string; impact: string; targets: string[] };

export async function seriousViolations(root: Element): Promise<AxeIssue[]> {
  const result = await axe.run(root, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    resultTypes: ['violations'],
  });
  return result.violations
    .filter((v) => v.impact === 'critical' || v.impact === 'serious')
    .map((v) => ({
      id: v.id,
      impact: v.impact ?? '',
      targets: v.nodes.map((n) => n.target.join(' ')),
    }));
}
