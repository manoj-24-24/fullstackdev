-- Fix: allow teachers and admins to update contribution status and score for reviews.
-- The previous policy only allowed students to update their own pending contributions,
-- which silently blocked all approval/review actions by teachers and admins.

drop policy if exists contributions_update on public.contributions;
create policy contributions_update on public.contributions for update to authenticated
  using (
    (student_id = auth.uid() and status = 'pending')
    or public.is_teacher_or_admin()
  )
  with check (
    student_id = auth.uid()
    or public.is_teacher_or_admin()
  );
