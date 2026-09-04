'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { GroupedListControlEvent, PluginControl, PluginManager } from '@/lib/scene-plugins';
import { i18n } from '@/lib/i18n';

function RadioControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'radio' }>;
  onChange: (value: string) => void;
}) {
  const defaultValue = control.default ?? control.options[0]?.value;
  const [value, setValue] = useState(defaultValue);
  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  return (
    <div className="ppSeg">
      {control.options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`ppSegOpt ${value === o.value ? 'on' : ''}`}
          onClick={() => {
            setValue(o.value);
            onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ToggleControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'toggle' }>;
  onChange: (value: boolean) => void;
}) {
  const defaultOn = Boolean(control.default ?? false);
  const [on, setOn] = useState(defaultOn);
  useEffect(() => {
    setOn(defaultOn);
  }, [defaultOn]);

  return (
    <div className="ppToggleRow">
      <span className="ppToggleLabel">{control.label}</span>
      <button
        type="button"
        className={`ppSwitch ${on ? 'on' : ''}`}
        aria-label={on ? i18n('plugin.panel.off') : i18n('plugin.panel.on')}
        onClick={() => {
          const next = !on;
          setOn(next);
          onChange(next);
        }}
      >
        <span className="ppKnob" />
      </button>
    </div>
  );
}

function SelectControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'select' }>;
  onChange: (value: string) => void;
}) {
  const defaultValue = control.default ?? control.options[0]?.value ?? '';
  const [value, setValue] = useState(defaultValue);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  return (
    <label className="ppField">
      <span className="ppFieldLabel">{control.label}</span>
      <select
        className="ppInput"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          onChange(event.currentTarget.value);
        }}
      >
        {control.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function SliderControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'slider' }>;
  onChange: (value: number) => void;
}) {
  const defaultValue = control.default ?? control.min;
  const [value, setValue] = useState(defaultValue);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  return (
    <label className="ppField">
      <span className="ppFieldHead">
        <span className="ppFieldLabel">{control.label}</span>
        <output className="ppFieldValue">{Number(value.toFixed(2))}</output>
      </span>
      <input
        className="ppRange"
        type="range"
        min={control.min}
        max={control.max}
        step={control.step ?? 1}
        value={value}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          setValue(next);
          onChange(next);
        }}
      />
    </label>
  );
}

function NumberControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'number' }>;
  onChange: (value: string) => void;
}) {
  const currentValue = control.value ?? String(control.default ?? 0);
  const [value, setValue] = useState(currentValue);
  useEffect(() => setValue(currentValue), [currentValue]);
  return (
    <label className="ppField ppFieldInline">
      <span className="ppFieldLabel">{control.label}</span>
      <input
        className="ppInput ppNumberInput"
        type="number"
        min={control.min}
        max={control.max}
        step={control.step ?? 'any'}
        value={value}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          setValue(nextValue);
          onChange(nextValue);
        }}
      />
    </label>
  );
}

function DateTimeControl({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'datetime' }>;
  onChange: (value: string) => void;
}) {
  const defaultValue = control.default ?? '';
  const [value, setValue] = useState(defaultValue);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  return (
    <label className="ppField">
      <span className="ppFieldLabel">{control.label}</span>
      <input
        className="ppInput"
        type="datetime-local"
        value={value}
        onChange={(event) => {
          setValue(event.currentTarget.value);
          onChange(event.currentTarget.value);
        }}
      />
    </label>
  );
}

function ListDrawer({
  control,
  onToggleItem,
}: {
  control: Extract<PluginControl, { kind: 'list' }>;
  onToggleItem: (itemId: string, selected: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedCount = control.items.filter((i) => i.selected).length;
  const setAll = (selected: boolean) =>
    control.items.forEach((it) => {
      if (!it.disabled && !!it.selected !== selected) onToggleItem(it.id, selected);
    });

  return (
    <div className="ppDrawer">
      <button type="button" className="ppDrawerHead" onClick={() => setOpen((v) => !v)}>
        <span>{control.label}</span>
        <span className="ppDrawerMeta">
          <span className="ppCount">
            {selectedCount}/{control.items.length}
          </span>
          <span className={`ppChevron ${open ? 'open' : ''}`}>›</span>
        </span>
      </button>
      {open && (
        <div className="ppDrawerBody">
          <div className="ppActions">
            <button type="button" className="ppAction" onClick={() => setAll(true)}>
              {i18n('plugin.panel.selectAll')}
            </button>
            <button type="button" className="ppAction" onClick={() => setAll(false)}>
              {i18n('plugin.panel.clear')}
            </button>
          </div>
          {control.items.length === 0 ? (
            <div className="ppEmpty">{i18n('plugin.panel.empty')}</div>
          ) : (
            <div className="ppGrid">
              {control.items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  disabled={it.disabled || it.loading}
                  className={`ppChip ${it.selected ? 'on' : ''}`}
                  onClick={() => onToggleItem(it.id, !it.selected)}
                >
                  {it.loading ? i18n('plugin.panel.loading') : it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GroupedListDrawer({
  control,
  onChange,
}: {
  control: Extract<PluginControl, { kind: 'grouped-list' }>;
  onChange: (event: GroupedListControlEvent) => void;
}) {
  const [open, setOpen] = useState(true);
  const itemCount = control.groups.reduce((sum, group) => sum + group.items.length, 0);
  const selectedCount = control.groups.reduce(
    (sum, group) => sum + group.items.filter((item) => item.selected).length,
    0,
  );

  return (
    <div className="ppDrawer">
      <button type="button" className="ppDrawerHead" onClick={() => setOpen((v) => !v)}>
        <span>{control.label}</span>
        <span className="ppDrawerMeta">
          <span className="ppCount">
            {selectedCount}/{itemCount}
          </span>
          <span className={`ppChevron ${open ? 'open' : ''}`}>›</span>
        </span>
      </button>
      {open && (
        <div className="ppDrawerBody">
          <div className="ppActions">
            <button type="button" className="ppAction" onClick={() => onChange({ type: 'all', selected: true })}>
              {i18n('plugin.panel.selectAll')}
            </button>
            <button type="button" className="ppAction" onClick={() => onChange({ type: 'all', selected: false })}>
              {i18n('plugin.panel.clear')}
            </button>
          </div>
          {control.groups.length === 0 ? (
            <div className="ppEmpty">{i18n('plugin.panel.emptyStories')}</div>
          ) : (
            <div className="ppGroupList">
              {control.groups.map((group) => (
                <div key={group.id} className="ppGroup">
                  <label className="ppGroupHead">
                    <input
                      type="checkbox"
                      checked={!!group.selected}
                      disabled={group.disabled}
                      onChange={(e) =>
                        onChange({ type: 'group', groupId: group.id, selected: e.currentTarget.checked })
                      }
                    />
                    <span>{group.label}</span>
                  </label>
                  <div className="ppGrid">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={item.disabled}
                        className={`ppChip ${item.selected ? 'on' : ''}`}
                        onClick={() =>
                          onChange({
                            type: 'item',
                            groupId: group.id,
                            itemId: item.id,
                            selected: !item.selected,
                          })
                        }
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PluginSection({ manager, pluginId }: { manager: PluginManager; pluginId: string }) {
  const plugin = manager.registry().find((item) => item.manifest.id === pluginId);
  const [open, setOpen] = useState(Boolean(plugin?.manifest.defaultOpen));
  if (!plugin) return null;
  const enabled = manager.isEnabled(pluginId);
  const unavailable = manager.isUnavailable(pluginId);
  const always = plugin.manifest.activation === 'always';
  const controlError = manager.getControlError(pluginId);
  return (
    <section className="ppItem">
      <div className="ppSectionHead">
        <button
          type="button"
          className="ppSectionToggle"
          disabled={unavailable}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="ppTitle">{plugin.manifest.title}</span>
          <span className={`ppChevron ${open ? 'open' : ''}`}>›</span>
        </button>
        {!always && (
          <button
            type="button"
            className={`ppSwitch ${enabled ? 'on' : ''}`}
            disabled={unavailable}
            aria-label={enabled ? i18n('plugin.panel.disable') : i18n('plugin.panel.enable')}
            onClick={() => manager.toggle(pluginId)}
          >
            <span className="ppKnob" />
          </button>
        )}
      </div>
      {enabled && open && (
        <div className="ppSectionBody">
          {manager.getControls(pluginId).map((control) => {
            if (control.kind === 'radio') {
              return <RadioControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'toggle') {
              return <ToggleControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'select') {
              return <SelectControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'slider') {
              return <SliderControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'number') {
              return <NumberControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'datetime') {
              return <DateTimeControl key={control.id} control={control} onChange={(value) => manager.setControl(pluginId, control.id, value)} />;
            }
            if (control.kind === 'grouped-list') {
              return <GroupedListDrawer key={control.id} control={control} onChange={(event) => manager.setControl(pluginId, control.id, event)} />;
            }
            if (control.kind === 'list') {
              return <ListDrawer key={control.id} control={control} onToggleItem={(itemId, selected) => manager.setControl(pluginId, control.id, { id: itemId, selected })} />;
            }
            if (control.kind === 'button') {
              return <button key={control.id} type="button" className="ppButton" onClick={() => manager.setControl(pluginId, control.id, true)}>{control.label}</button>;
            }
            return null;
          })}
          {controlError && <div className="ppError" role="alert">{controlError}</div>}
        </div>
      )}
    </section>
  );
}

export function PluginPanel({ manager }: { manager: PluginManager }) {
  const version = useSyncExternalStore(
    (cb) => manager.subscribe(cb),
    () => manager.getVersion(),
    () => 0,
  );
  void version;

  return (
    <div className="pluginPanel">
      <div className="ppHeader">{i18n('plugin.panel.title')}</div>
      {manager.registry().map((plugin) => (
        <PluginSection key={plugin.manifest.id} manager={manager} pluginId={plugin.manifest.id} />
      ))}
      <style jsx global>{`
        .pluginPanel {
          position: absolute;
          right: 16px;
          top: 64px;
          width: 280px;
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 90px);
          overflow-y: auto;
          background: rgba(15, 23, 42, 0.92);
          border: 0.5px solid rgba(148, 163, 184, 0.22);
          border-radius: 12px;
          padding: 12px 13px;
          color: #e2e8f0;
          z-index: 12;
          font-size: 13px;
          backdrop-filter: blur(8px);
          box-shadow: 0 8px 28px rgba(0, 0, 0, 0.32);
        }
        .ppHeader {
          font-weight: 500;
          font-size: 13px;
          color: #f1f5ff;
          padding-bottom: 10px;
          margin-bottom: 2px;
          border-bottom: 0.5px solid rgba(148, 163, 184, 0.18);
        }
        .ppItem {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 0.5px solid rgba(148, 163, 184, 0.14);
        }
        .ppToggleRow {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .ppToggleRow {
          margin-top: 10px;
        }
        .ppTitle {
          flex: 1;
          font-weight: 500;
          color: #f1f5ff;
          text-align: left;
        }
        .ppSectionHead {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .ppSectionToggle {
          min-width: 0;
          min-height: 30px;
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 0;
          border: 0;
          color: inherit;
          background: transparent;
          cursor: pointer;
        }
        .ppSectionToggle:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }
        .ppSectionBody {
          padding: 0 1px 2px;
        }
        .ppToggleLabel {
          color: #cbd5e1;
          font-size: 12px;
        }
        .ppSwitch {
          width: 38px;
          height: 21px;
          border-radius: 11px;
          background: rgba(148, 163, 184, 0.28);
          position: relative;
          border: none;
          cursor: pointer;
          padding: 0;
          flex: none;
          transition: background 0.15s;
        }
        .ppSwitch:disabled {
          cursor: not-allowed;
          opacity: 0.45;
        }
        .ppSwitch.on {
          background: #34d399;
        }
        .ppKnob {
          position: absolute;
          top: 2px;
          left: 2px;
          width: 17px;
          height: 17px;
          border-radius: 50%;
          background: #f8fafc;
          transition: left 0.15s;
        }
        .ppSwitch.on .ppKnob {
          left: 19px;
        }
        .ppSeg {
          display: flex;
          gap: 3px;
          margin-top: 10px;
          padding: 3px;
          background: rgba(148, 163, 184, 0.1);
          border-radius: 9px;
        }
        .ppSegOpt {
          flex: 1;
          padding: 6px 0;
          font-size: 12px;
          font-weight: 500;
          color: #94a3b8;
          background: transparent;
          border: none;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ppSegOpt.on {
          background: #2563eb;
          color: #fff;
          box-shadow: 0 1px 4px rgba(37, 99, 235, 0.4);
        }
        .ppField {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-top: 10px;
        }
        .ppFieldInline {
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
        }
        .ppFieldHead {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .ppFieldLabel {
          color: #cbd5e1;
          font-size: 12px;
        }
        .ppFieldValue {
          color: #93c5fd;
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        }
        .ppInput {
          width: 100%;
          min-width: 0;
          height: 32px;
          box-sizing: border-box;
          padding: 0 8px;
          border: 0.5px solid rgba(148, 163, 184, 0.28);
          border-radius: 6px;
          background: rgba(15, 23, 42, 0.78);
          color: #e2e8f0;
          font: inherit;
          font-size: 12px;
          color-scheme: dark;
        }
        .ppNumberInput {
          width: 154px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }
        .ppRange {
          width: 100%;
          margin: 0;
          accent-color: #38bdf8;
        }
        .ppError {
          margin-top: 10px;
          padding: 8px;
          border: 0.5px solid rgba(248, 113, 113, 0.55);
          border-radius: 6px;
          background: rgba(127, 29, 29, 0.28);
          color: #fecaca;
          font-size: 12px;
          line-height: 1.45;
        }
        .ppDrawer {
          margin-top: 10px;
        }
        .ppDrawerHead {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(148, 163, 184, 0.1);
          border: 0.5px solid rgba(148, 163, 184, 0.2);
          border-radius: 8px;
          padding: 8px 10px;
          color: #e2e8f0;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
        }
        .ppDrawerMeta {
          display: flex;
          align-items: center;
          gap: 7px;
        }
        .ppCount {
          color: #94a3b8;
          font-weight: 400;
        }
        .ppChevron {
          display: inline-block;
          color: #94a3b8;
          transition: transform 0.15s;
        }
        .ppChevron.open {
          transform: rotate(90deg);
        }
        .ppDrawerBody {
          margin-top: 8px;
        }
        .ppActions {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }
        .ppAction {
          font-size: 11px;
          color: #93c5fd;
          background: none;
          border: none;
          padding: 0;
          cursor: pointer;
        }
        .ppAction:hover {
          color: #bfdbfe;
        }
        .ppGroup {
          margin-top: 8px;
        }
        .ppGroup:first-child {
          margin-top: 0;
        }
        .ppGroupHead {
          display: flex;
          align-items: center;
          gap: 6px;
          min-height: 24px;
          color: #dbeafe;
          font-size: 12px;
          font-weight: 500;
        }
        .ppGroupHead input {
          width: 13px;
          height: 13px;
          accent-color: #2563eb;
        }
        .ppGrid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
          max-height: 232px;
          overflow-y: auto;
        }
        .ppGroup .ppGrid {
          margin-top: 5px;
        }
        .ppChip {
          min-width: 0;
          min-height: 28px;
          padding: 6px 4px;
          font-size: 11px;
          text-align: center;
          color: #94a3b8;
          background: rgba(148, 163, 184, 0.08);
          border: 0.5px solid rgba(148, 163, 184, 0.16);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.12s;
          overflow-wrap: anywhere;
        }
        .ppChip.on {
          background: rgba(37, 99, 235, 0.9);
          border-color: rgba(37, 99, 235, 0.9);
          color: #fff;
        }
        .ppChip:disabled {
          cursor: wait;
          opacity: 0.55;
        }
        .ppButton {
          width: 100%;
          margin-top: 10px;
          min-height: 30px;
          border: 0.5px solid rgba(148, 163, 184, 0.24);
          border-radius: 7px;
          background: rgba(148, 163, 184, 0.1);
          color: #dbeafe;
          cursor: pointer;
        }
        .ppEmpty {
          padding: 8px 0;
          color: #94a3b8;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
