# Interaction states

Garage forms, account and recovery forms, reminder preferences, and feedback keep unsaved drafts in memory. Closing a changed form, switching forms, signing out, or following an application link asks **Keep editing** or **Discard changes**. Reverting editable values to the opening or last-saved values removes the warning. Changes to language, validation messages, or loaded defaults do not create a draft. Passwords and unfinished drafts are never written to browser storage.

Same-document browser Back/Forward restores the current history entry before asking, then replays the requested traversal after discard. History entries retain Next.js metadata. Reloading, closing the tab, or leaving the document uses the browser's native unsaved-work prompt while a draft or operation is active. Browsers control that prompt's wording and whether it can be displayed.

Saving, deleting, preparing photos, and transferring the guest garage prevent dismissal and duplicate requests. Failed writes keep the draft editable for retry. A successful write followed by a refresh failure closes the form, shows the existing refresh warning, and offers a read-only refresh retry. It never repeats the write or removes committed photos.

Vehicle, maintenance-task, and visit saves/deletes show one success toast, retained across navigation. It dismisses after six seconds, pausing while hovered, focused, or the document is hidden. Account changes, reminder preferences, and feedback retain their inline confirmation messages. Email changes remain pending until confirmation.

Visit and fill-up photos show preparation, the current file and total count, and record saving. Local mode says “Saving photo”; cloud mode says “Uploading photo.” The progress bar counts completed files rather than claiming byte-level percentages. Preparation batches cannot overlap. Failed uploads clean up only the new uploads, preserving the draft and existing attachments. Signup transfers show record saving, photo upload and verification, garage verification, and final cleanup; resumability and verification remain unchanged.

Feedback shows submission activity with screenshot counts or status-check activity. Transport failures retain the reviewed submission identifier and check its receipt before reposting. Explicitly discarding an unfinished report clears that draft; it does not withdraw a report already submitted.

Persisted vehicle, maintenance-task, visit, and fill-up deletion uses a shared confirmation dialog with Cancel focused initially. Vehicle deletion explains that tasks, visits, fill-ups, and photos are included. Failed deletion retains the dialog for retry. Removing unsaved visit items or photo selections remains immediate.

Only the topmost dialog handles Escape and traps focus. Underlying content is inert until the dialog stack closes; focus returns to the previous control when available. Escape or an outside click on a confirmation cancels it. Escape first closes an open make/model suggestion list.

## Verification

The interaction, form-protection, history-guard, account, notification, feedback, transfer, and garage save-recovery suites cover dismissal, baseline comparison, busy state, independent forms, file preparation, upload progress, retries, committed saves, and English/Spanish copy. Browser checks cover history restoration/replay, reload cancellation, focus return, and responsive dialog layout. No schema migration or upload-transport change is required.
