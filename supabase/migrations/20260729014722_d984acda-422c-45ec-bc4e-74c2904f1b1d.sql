CREATE POLICY "store owner manages own files" ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'store' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'store' AND (storage.foldername(name))[1] = auth.uid()::text);