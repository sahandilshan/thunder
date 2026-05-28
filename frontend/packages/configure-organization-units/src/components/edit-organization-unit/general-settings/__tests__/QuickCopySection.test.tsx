/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import {screen, fireEvent, waitFor, renderWithProviders, renderHook} from '@thunderid/test-utils';
import {useTranslation} from 'react-i18next';
import {describe, it, expect, vi, beforeEach, beforeAll} from 'vitest';
import type {OrganizationUnit} from '../../../../models/organization-unit';
import QuickCopySection from '../QuickCopySection';

describe('QuickCopySection', () => {
  let t: (key: string) => string;

  beforeAll(() => {
    ({t} = renderHook(() => useTranslation()).result.current);
  });
  const mockOrganizationUnit: OrganizationUnit = {
    id: 'ou-123',
    handle: 'engineering',
    name: 'Engineering',
    description: 'Engineering department',
    parent: null,
  };

  const mockOnCopyToClipboard = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the quick copy section', () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    expect(screen.getByText(t('organizationUnits:edit.general.sections.quickCopy.title'))).toBeInTheDocument();
    expect(screen.getByText(t('organizationUnits:edit.general.sections.quickCopy.description'))).toBeInTheDocument();
  });

  it('should render handle field with correct value', () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const handleInput = screen.getByDisplayValue('engineering');
    expect(handleInput).toBeInTheDocument();
    expect(handleInput).toHaveAttribute('readonly');
  });

  it('should render organization unit ID field with correct value', () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const idInput = screen.getByDisplayValue('ou-123');
    expect(idInput).toBeInTheDocument();
    expect(idInput).toHaveAttribute('readonly');
  });

  it('should call onCopyToClipboard when handle copy button is clicked', async () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const copyButtons = screen.getAllByRole('button', {name: t('common:actions.copy')});
    fireEvent.click(copyButtons[0]); // First copy button is for handle

    await waitFor(() => {
      expect(mockOnCopyToClipboard).toHaveBeenCalledWith('engineering', 'handle');
    });
  });

  it('should call onCopyToClipboard when ID copy button is clicked', async () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const copyButtons = screen.getAllByRole('button', {name: t('common:actions.copy')});
    fireEvent.click(copyButtons[1]); // Second copy button is for ID

    await waitFor(() => {
      expect(mockOnCopyToClipboard).toHaveBeenCalledWith('ou-123', 'ou_id');
    });
  });

  it('should show check icon when handle is copied', () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField="handle"
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const copiedButton = screen.getByLabelText(t('common:actions.copied'));
    expect(copiedButton).toBeInTheDocument();
  });

  it('should show check icon when ID is copied', () => {
    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField="ou_id"
        onCopyToClipboard={mockOnCopyToClipboard}
      />,
    );

    const copiedButton = screen.getByLabelText(t('common:actions.copied'));
    expect(copiedButton).toBeInTheDocument();
  });

  it('should handle copy errors gracefully', async () => {
    const mockOnCopyError = vi.fn().mockRejectedValue(new Error('Copy failed'));

    renderWithProviders(
      <QuickCopySection
        organizationUnit={mockOrganizationUnit}
        copiedField={null}
        onCopyToClipboard={mockOnCopyError}
      />,
    );

    const copyButtons = screen.getAllByLabelText(t('common:actions.copy'));
    fireEvent.click(copyButtons[0]);

    await waitFor(() => {
      expect(mockOnCopyError).toHaveBeenCalled();
    });

    // Should not throw error
  });
});
