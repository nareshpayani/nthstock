import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useChartStudies } from '../model/studiesStore';
import { IndicatorsMenu } from './IndicatorsMenu';

afterEach(() => {
  window.localStorage.clear();
  useChartStudies.setState({ studies: ['volume'] });
});

const open = () =>
  fireEvent.keyDown(screen.getByRole('button', { name: /^Indicators/ }), { key: 'Enter' });

describe('IndicatorsMenu (NSTOCK-0460)', () => {
  it('labels the trigger with how many studies are on', () => {
    useChartStudies.setState({ studies: ['volume', 'sma20'] });
    render(<IndicatorsMenu />);
    expect(screen.getByRole('button', { name: 'Indicators 2 on' })).toHaveTextContent('2');
  });

  it('shows no badge when none are on', () => {
    useChartStudies.setState({ studies: [] });
    render(<IndicatorsMenu />);
    const trigger = screen.getByRole('button', { name: 'Indicators, none on' });
    expect(trigger).not.toHaveTextContent(/\d/);
  });

  it('opens, toggles a study, and stays open for the next pick', () => {
    render(<IndicatorsMenu />);
    open();
    const sma = screen.getByRole('menuitemcheckbox', { name: /Moving average 20/ });
    expect(sma).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sma);
    expect(useChartStudies.getState().studies).toEqual(['volume', 'sma20']);
    // Still open: the other items are there and the pick shows as checked.
    expect(screen.getByRole('menuitemcheckbox', { name: /Moving average 20/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /VWAP/ }));
    expect(useChartStudies.getState().studies).toEqual(['volume', 'sma20', 'vwap']);
    // The trigger is hidden from the tree while the menu is open.
    expect(
      screen.getByRole('button', { name: 'Indicators 3 on', hidden: true }),
    ).toBeInTheDocument();
  });

  it('turns a checked study off', () => {
    render(<IndicatorsMenu />);
    open();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Volume/ }));
    expect(useChartStudies.getState().studies).toEqual([]);
  });

  it('on an index, shows Volume off and greyed with why, and leaves it out of the count', () => {
    useChartStudies.setState({ studies: ['volume', 'sma20'] });
    render(<IndicatorsMenu volume={false} />);
    expect(screen.getByRole('button', { name: 'Indicators 1 on' })).toBeInTheDocument();
    open();
    const volume = screen.getByRole('menuitemcheckbox', { name: /Volume/ });
    expect(volume).toHaveAttribute('aria-disabled', 'true');
    expect(volume).toHaveAttribute('aria-checked', 'false');
    expect(volume).toHaveTextContent('An index trades no shares');
    // The choice is kept for stock charts.
    expect(useChartStudies.getState().studies).toEqual(['volume', 'sma20']);
  });
});
