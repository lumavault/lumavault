import type { App } from '@lumavault/sdk/gen/lumavault/iam/v1/iam_pb'
import { Checkbox } from '@lumavault/ui/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@lumavault/ui/components/ui/field'
import { Input } from '@lumavault/ui/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@lumavault/ui/components/ui/select'
import { appLabel } from '@lumavault/ui/household'

import {
  ALL_APPS,
  MAX_MEMBER_LIMIT,
  toggleEnabledApp,
  type CapUnit,
  type StorageCapDraft,
} from './-storage-cap'

const UNIT_ITEMS = { B: 'B', MB: 'MB', GB: 'GB', TB: 'TB' } as const

export interface AllowanceFieldsProps {
  idPrefix: string
  capDraft: StorageCapDraft
  onCapChange: (next: StorageCapDraft) => void
  capError?: string | null
  enabledApps: readonly App[]
  onEnabledAppsChange: (next: App[]) => void
  appsError?: string | null
  memberLimit: string
  onMemberLimitChange: (next: string) => void
  memberLimitError?: string | null
}

export function AllowanceFields({
  idPrefix,
  capDraft,
  onCapChange,
  capError,
  enabledApps,
  onEnabledAppsChange,
  appsError,
  memberLimit,
  onMemberLimitChange,
  memberLimitError,
}: AllowanceFieldsProps) {
  return (
    <>
      <Field>
        <div className="flex items-center justify-between gap-2">
          <FieldLabel htmlFor={`${idPrefix}-cap-amount`}>
            Storage cap
          </FieldLabel>
          <label className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={capDraft.unlimited}
              onCheckedChange={(checked) =>
                onCapChange({ ...capDraft, unlimited: checked === true })
              }
            />
            Unlimited
          </label>
        </div>
        {!capDraft.unlimited ? (
          <div className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-cap-amount`}
              inputMode="numeric"
              value={capDraft.amount}
              onChange={(e) =>
                onCapChange({ ...capDraft, amount: e.target.value })
              }
            />
            <Select
              items={UNIT_ITEMS}
              value={capDraft.unit}
              onValueChange={(val) => {
                if (val && val in UNIT_ITEMS) {
                  onCapChange({ ...capDraft, unit: val as CapUnit })
                }
              }}
            >
              <SelectTrigger className="w-24" aria-label="Storage unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(UNIT_ITEMS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        ) : (
          <FieldDescription>
            Uses the full server setup cap (unlimited).
          </FieldDescription>
        )}
        {capError ? <FieldError>{capError}</FieldError> : null}
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Enabled apps</FieldLegend>
        <div className="flex flex-wrap gap-4">
          {ALL_APPS.map((app) => (
            <label key={app} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={enabledApps.includes(app)}
                onCheckedChange={(next) =>
                  onEnabledAppsChange(
                    toggleEnabledApp(enabledApps, app, next === true),
                  )
                }
              />
              {appLabel(app)}
            </label>
          ))}
        </div>
        {appsError ? <FieldError>{appsError}</FieldError> : null}
      </FieldSet>

      <Field>
        <FieldLabel htmlFor={`${idPrefix}-member-limit`}>
          Member limit
        </FieldLabel>
        <Input
          id={`${idPrefix}-member-limit`}
          type="number"
          min={1}
          max={MAX_MEMBER_LIMIT}
          value={memberLimit}
          onChange={(e) => onMemberLimitChange(e.target.value)}
        />
        {memberLimitError ? <FieldError>{memberLimitError}</FieldError> : null}
      </Field>
    </>
  )
}
