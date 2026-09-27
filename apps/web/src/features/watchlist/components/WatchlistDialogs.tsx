import { zodResolver } from '@hookform/resolvers/zod';
import { WatchlistName, sameWatchlistName, type Watchlist } from '@nthstock/contracts';
import { Button, Dialog, Field, Input } from '@nthstock/ui';
import { useId, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import {
  useCreateWatchlist,
  useDeleteWatchlist,
  useRenameWatchlist,
} from '../hooks/useWatchlistMutations';
import { strings } from '../strings';

/** Which dialog is open: New, Rename or Delete (T-120). */
export type WatchlistDialogState =
  { kind: 'create' } | { kind: 'rename'; list: Watchlist } | { kind: 'delete'; list: Watchlist };

export type WatchlistDialogsProps = {
  dialog: WatchlistDialogState;
  lists: readonly Watchlist[];
  onClose: () => void;
  /** Called with the new list's name after Create, so the section can open its tab. */
  onCreated: (name: string) => void;
  announce: (text: string) => void;
};

/**
 * The name rule from packages/contracts (1 to 24 characters after trimming) plus uniqueness
 * against the user's other lists, ignoring case, as both backends check it.
 */
export function watchlistNameForm(otherNames: readonly string[]) {
  return z.object({
    name: WatchlistName.refine(
      (name) => !otherNames.some((other) => sameWatchlistName(other, name)),
      { error: strings.dialogs.nameTaken },
    ),
  });
}

type NameFormInput = { name: string };

function NameDialog({
  title,
  submitLabel,
  initialName,
  otherNames,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initialName: string;
  otherNames: readonly string[];
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const schema = watchlistNameForm(otherNames);
  const form = useForm<NameFormInput, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: initialName },
  });
  const field = form.register('name');
  const submit = form.handleSubmit(({ name }) => {
    onSubmit(name);
    onClose();
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={title}
      initialFocus={inputRef}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.dialogs.cancel}
          </Button>
          <Button type="submit" form={formId}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => void submit(event)}>
        <Field
          label={strings.dialogs.nameLabel}
          hint={strings.dialogs.nameHint}
          error={form.formState.errors.name?.message}
        >
          <Input
            {...field}
            ref={(node) => {
              field.ref(node);
              inputRef.current = node;
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      </form>
    </Dialog>
  );
}

/**
 * New, Rename and Delete watchlist dialogs (T-120). Loaded lazily: none of this code is needed
 * until one opens. Changes are optimistic (T-118): the dialog closes at once, the tab updates, and
 * a failure puts it back with a toast.
 */
export function WatchlistDialogs({
  dialog,
  lists,
  onClose,
  onCreated,
  announce,
}: WatchlistDialogsProps) {
  const create = useCreateWatchlist();
  const rename = useRenameWatchlist();
  const remove = useDeleteWatchlist();

  if (dialog.kind === 'create') {
    return (
      <NameDialog
        title={strings.dialogs.createTitle}
        submitLabel={strings.dialogs.create}
        initialName=""
        otherNames={lists.map((list) => list.name)}
        onClose={onClose}
        onSubmit={(name) => {
          create.mutate({ name });
          onCreated(name);
          announce(strings.announce.created(name));
        }}
      />
    );
  }

  const { list } = dialog;
  if (dialog.kind === 'rename') {
    return (
      <NameDialog
        title={strings.dialogs.renameTitle}
        submitLabel={strings.dialogs.save}
        initialName={list.name}
        otherNames={lists.filter((other) => other.id !== list.id).map((other) => other.name)}
        onClose={onClose}
        onSubmit={(name) => {
          if (name !== list.name) rename.mutate({ id: list.id, name });
          announce(strings.announce.renamed(name));
        }}
      />
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={strings.dialogs.deleteTitle(list.name)}
      description={strings.dialogs.deleteBody(list.items.length)}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.dialogs.cancel}
          </Button>
          <Button
            variant="sell"
            onClick={() => {
              remove.mutate({ id: list.id });
              announce(strings.announce.deleted(list.name));
              onClose();
            }}
          >
            {strings.dialogs.deleteConfirm}
          </Button>
        </>
      }
    />
  );
}
