-- Migration: Enable RLS on tables created after 032_security_fixes.sql
-- Tables: mode_documents, mode_document_history, living_document, living_document_history, state_check_sessions

-- ============================================================================
-- ENABLE RLS ON NEW TABLES
-- ============================================================================

-- mode_documents
ALTER TABLE public.mode_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to mode_documents" ON public.mode_documents;
CREATE POLICY "Service role has full access to mode_documents" ON public.mode_documents
  FOR ALL USING (auth.role() = 'service_role');

-- mode_document_history
ALTER TABLE public.mode_document_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to mode_document_history" ON public.mode_document_history;
CREATE POLICY "Service role has full access to mode_document_history" ON public.mode_document_history
  FOR ALL USING (auth.role() = 'service_role');

-- living_document
ALTER TABLE public.living_document ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to living_document" ON public.living_document;
CREATE POLICY "Service role has full access to living_document" ON public.living_document
  FOR ALL USING (auth.role() = 'service_role');

-- living_document_history
ALTER TABLE public.living_document_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to living_document_history" ON public.living_document_history;
CREATE POLICY "Service role has full access to living_document_history" ON public.living_document_history
  FOR ALL USING (auth.role() = 'service_role');

-- state_check_sessions
ALTER TABLE public.state_check_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role has full access to state_check_sessions" ON public.state_check_sessions;
CREATE POLICY "Service role has full access to state_check_sessions" ON public.state_check_sessions
  FOR ALL USING (auth.role() = 'service_role');
