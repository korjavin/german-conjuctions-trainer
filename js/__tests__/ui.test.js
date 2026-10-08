import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dom } from '../dom.js';

// setup.js mocks ui.js for every other spec; this one needs the real module.
const { toast, confirm } = await vi.importActual('../ui.js');

describe('ui.toast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        dom.toastRoot.replaceChildren();
        dom.toastRoot.showPopover = vi.fn();
        dom.toastRoot.hidePopover = vi.fn();
    });
    afterEach(() => vi.useRealTimers());

    it('shows one toast and auto-dismisses after 4 s', () => {
        toast({ text: 'First' });
        toast({ text: 'Saved', tone: 'success' });
        const items = dom.toastRoot.querySelectorAll('.gct-toast');
        expect(items).toHaveLength(1);
        expect(items[0].textContent).toBe('Saved');
        expect(items[0].classList.contains('gct-toast--success')).toBe(true);
        expect(dom.toastRoot.showPopover).toHaveBeenCalled();

        vi.advanceTimersByTime(3999);
        expect(dom.toastRoot.children).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(dom.toastRoot.children).toHaveLength(0);
    });

    it('renders text as text, not HTML', () => {
        toast({ text: '<img src=x>', tone: 'danger' });
        expect(dom.toastRoot.querySelector('img')).toBeNull();
        expect(dom.toastRoot.querySelector('.gct-toast').getAttribute('role')).toBe('alert');
    });

    it('runs the action callback and dismisses', () => {
        const run = vi.fn();
        toast({ text: 'Hidden', action: { label: 'Undo', run } });
        const btn = dom.toastRoot.querySelector('.gct-toast__action');
        expect(btn.textContent).toBe('Undo');
        btn.dispatchEvent(new Event('click'));
        expect(run).toHaveBeenCalledOnce();
        expect(dom.toastRoot.children).toHaveLength(0);
    });
});

describe('ui.confirm', () => {
    const dlg = dom.confirmDialog;
    const actions = [{ label: 'Delete topic', kind: 'danger', value: 'delete' }, { label: 'Cancel', kind: 'ghost' }];

    beforeEach(() => {
        dlg.showModal.mockClear();
        // The dom mock's close() is a stub: emulate the native close event.
        dlg.close.mockImplementation(() => dlg.onclose?.());
    });

    it('resolves the chosen action value', async () => {
        const result = confirm({ title: 'Delete?', body: 'Gone for good.', actions });
        expect(dlg.showModal).toHaveBeenCalledOnce();
        expect(dlg.querySelector('.gct-dialog__title').textContent).toBe('Delete?');
        const buttons = dlg.querySelectorAll('.gct-dialog__actions button');
        expect(buttons[0].className).toBe('gct-btn gct-btn--danger');
        expect(buttons[1].autofocus).toBe(true);
        buttons[0].dispatchEvent(new Event('click'));
        await expect(result).resolves.toBe('delete');
    });

    it('resolves null for the cancel action', async () => {
        const result = confirm({ title: 'Delete?', actions });
        dlg.querySelectorAll('.gct-dialog__actions button')[1].dispatchEvent(new Event('click'));
        await expect(result).resolves.toBeNull();
    });

    it('resolves null on Escape / scrim click', async () => {
        const escaped = confirm({ title: 'Delete?', actions });
        dlg.close(); // Escape closes the dialog natively
        await expect(escaped).resolves.toBeNull();

        const scrim = confirm({ title: 'Delete?', actions });
        dlg.onclick({ target: dlg });
        await expect(scrim).resolves.toBeNull();
    });
});
