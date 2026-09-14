saya tidak bisa memastikan e2e test sudah benar atau belum. 
Pastikan bagaimana saya dapat memeriksa ini secara manual? apakah perlu log ke file dari tiap proses?
Bagaimana alur yang sebenar nya terjadi, perlu lebih di visualisasikan, apa yang terlibat, dari input sampe ke database.
visualisasi menggunakan block 
```mermaid
```
dalam MD file.

semua test ini dijelaskan per skenario nya secara rinci termasuk menggunakan visualisasi tadi. pada file test.
payments.circuit-breaker.e2e-spec.ts
payments.durable-scheduler.e2e-spec.ts
payments.exhaustion.e2e-spec.ts
payments.idempotency.e2e-spec.ts
payments.permanent.e2e-spec.ts
payments.retry-after.e2e-spec.ts
payments.transient.e2e-spec.ts

jadikan subtask pemeriksaan TASK-14a-<nama-file-test-e22>.md

terakhir bagaimana tambahkan command menjalankan e2e test per file