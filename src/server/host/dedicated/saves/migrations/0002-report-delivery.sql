-- A retry after an ambiguous commit cannot duplicate a report.
alter table chat_report add column delivery_id uuid;
create unique index chat_report_delivery on chat_report (delivery_id);
