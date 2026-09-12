export type Role = 'student' | 'teacher' | 'admin';
export type ContributionStatus = 'pending' | 'approved' | 'needs_improvement';

export interface Profile {
  id: string;
  full_name: string;
  username: string;
  avatar: string | null;
  bio: string;
  github_url: string | null;
  linkedin_url: string | null;
  role: Role;
}

export interface Subject { id: string; name: string; }
export interface Contribution {
  id: string;
  student_id: string;
  subject_id: string;
  title: string;
  summary: string;
  description: string;
  code: string;
  github_url: string | null;
  contribution_date: string;
  status: ContributionStatus;
  score: number | null;
  created_at: string;
  updated_at: string;
  subjects?: Subject;
  profiles?: Profile;
}
export interface Feedback { id: string; contribution_id: string; teacher_id: string; reviewer_name?: string; reviewer_role?: string | null; feedback: string; score: number; status: ContributionStatus; created_at: string; profiles?: Profile; }
export interface Activity { id: string; student_id: string; activity_date: string; contribution_count: number; daily_score: number; }
export interface Notification { id: string; user_id: string; sender_id?: string | null; sender_name?: string | null; sender_role?: string | null; title: string; message: string; type: string; read: boolean; created_at: string; }
export interface ContributionFile { id: string; contribution_id: string; file_url: string; file_name: string; file_type: string; }
export type NoteCategory = 'Frontend' | 'Backend' | 'Cloud Computing';
export interface StudyNote { id: string; user_id: string; category: NoteCategory; title: string; description: string; file_path: string; file_name: string; file_type: string; created_at: string; profiles?: { full_name: string; role: string } | null; }
