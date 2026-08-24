-- Dados inteiramente fictícios para desenvolvimento local.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','joao@nikufra.ai','',now(),'{}','{"nome":"João Milhazes"}',now(),now()),
('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','marta@nikufra.ai','',now(),'{}','{"nome":"Marta Silva"}',now(),now()),
('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','tomas@nikufra.ai','',now(),'{}','{"nome":"Tomás Costa"}',now(),now())
on conflict (id) do nothing;

update public.profiles set ativo = true, role = 'admin', cor = '#3B82F6' where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set ativo = true, cor = '#8B5CF6' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set ativo = true, cor = '#14B8A6' where id = '33333333-3333-3333-3333-333333333333';

insert into public.empresas (id,nome,nif,website,vertical,pais,cidade,num_colaboradores,num_unidades_fabris,erp,mes,nivel_maturidade_digital,origem,notas) values
('10000000-0000-0000-0000-000000000001','Ferrovia Norte','PT509100001','https://ferrovianorte.example','metalomecanica','PT','Braga',280,2,'Primavera','Forcam',3,'referencia','Fabricante de estruturas metálicas. Dados fictícios.'),
('10000000-0000-0000-0000-000000000002','Alumitech','PT509100002','https://alumitech.example','aluminio','PT','Aveiro',420,3,'SAP','Opcenter',4,'evento','Extrusão e tratamento de alumínio.'),
('10000000-0000-0000-0000-000000000003','Moldes Atlas','PT509100003','https://moldesatlas.example','automovel','PT','Marinha Grande',190,1,'PHC','',2,'outbound_linkedin','Moldes técnicos para automóvel.'),
('10000000-0000-0000-0000-000000000004','Corkline','PT509100004','https://corkline.example','cortica','PT','Santa Maria da Feira',510,4,'SAP','Siemens Opcenter',4,'inbound','Transformação de cortiça.'),
('10000000-0000-0000-0000-000000000005','Tecnoval Components','PT509100005','https://tecnoval.example','automovel','PT','Vila Nova de Famalicão',340,2,'Primavera','',3,'outbound_email','Componentes metálicos.'),
('10000000-0000-0000-0000-000000000006','CarbonForm','ESB09010006','https://carbonform.example','compositos','ES','Vigo',230,1,'Dynamics','',3,'rede_pessoal','Compósitos avançados.'),
('10000000-0000-0000-0000-000000000007','Elecwave','PT509100007','https://elecwave.example','eletronica','PT','Maia',160,1,'PHC','',2,'evento','Montagem eletrónica.'),
('10000000-0000-0000-0000-000000000008','Maquinorte','PT509100008','https://maquinorte.example','metalomecanica','PT','Guimarães',125,1,'Eticadata','',2,'referencia','Máquinas especiais.'),
('10000000-0000-0000-0000-000000000009','Autovia Systems','DE809100009','https://autovia.example','automovel','DE','Stuttgart',680,5,'SAP','Apriso',5,'outbound_linkedin','Sistemas para linha automóvel.'),
('10000000-0000-0000-0000-000000000010','LusoCork','PT509100010','https://lusocork.example','cortica','PT','Espinho',210,2,'Primavera','',3,'outbound_email','Produtos técnicos de cortiça.'),
('10000000-0000-0000-0000-000000000011','Precision Tooling','PT509100011','https://precisiontooling.example','metalomecanica','PT','Oliveira de Azeméis',145,2,'PHC','',4,'inbound','Ferramentas de precisão.'),
('10000000-0000-0000-0000-000000000012','Circuita','FR909100012','https://circuita.example','eletronica','FR','Lyon',380,2,'SAP','Critical Manufacturing',4,'evento','Eletrónica industrial.'),
('10000000-0000-0000-0000-000000000013','Extrusal Tech','PT509100013','https://extrusal.example','aluminio','PT','Setúbal',300,2,'Sage','',3,'outbound_linkedin','Perfis de alumínio.'),
('10000000-0000-0000-0000-000000000014','Metaloeste','PT509100014','https://metaloeste.example','metalomecanica','PT','Leiria',95,1,'Eticadata','',2,'referencia','Subcontratação metalomecânica.'),
('10000000-0000-0000-0000-000000000015','E-Motion Parts','PT509100015','https://emotionparts.example','automovel','PT','Palmela',470,3,'SAP','',3,'outbound_email','Componentes para mobilidade elétrica.')
on conflict (id) do nothing;

insert into public.contactos (id,empresa_id,nome,cargo,email,telefone,principal) values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Rui Correia','Diretor de Operações','rui.correia@ferrovianorte.example','+351 912 304 118',true),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Ana Faria','Diretora Industrial','ana.faria@alumitech.example','+351 934 820 442',true),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Pedro Leal','Plant Manager','pedro.leal@moldesatlas.example','+351 919 772 360',true),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','Sofia Martins','CIO','sofia.martins@corkline.example','+351 962 117 905',true),
('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','Luís Amaral','Melhoria Contínua','luis.amaral@tecnoval.example','+351 913 600 271',true),
('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','Mónica Santos','COO','monica.santos@carbonform.example','+34 610 442 083',true),
('20000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','André Melo','Diretor de Produção','andre.melo@elecwave.example','+351 968 044 517',true),
('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008','Teresa Sousa','Diretora Geral','teresa.sousa@maquinorte.example','+351 916 588 930',true),
('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','Daniel Pires','Head of Data','daniel.pires@autovia.example','+49 152 840 318',true),
('20000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000010','Clara Esteves','Operations Excellence','clara.esteves@lusocork.example','+351 932 488 156',true),
('20000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011','Miguel Barros','CEO','miguel.barros@precisiontooling.example','+351 961 600 213',true),
('20000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','Laura Viana','Diretora de Sistemas','laura.viana@circuita.example','+33 688 210 552',true)
on conflict (id) do nothing;

insert into public.oportunidades (id,empresa_id,contacto_principal_id,owner_id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,data_primeiro_contacto,data_prevista_fecho,data_fecho,motivo_perda) values
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Sistema de planeamento inteligente','proposta','misto',68000,null,'2026-02-12','2026-10-15',null,null),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Arquitetura de dados industrial','piloto','piloto',92000,24000,'2026-01-18','2026-09-30',null,null),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','Otimização preditiva','reuniao_feita','consultoria',45000,null,'2026-04-02','2026-11-20',null,null),
('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000004','11111111-1111-1111-1111-111111111111','Data platform multi-fábrica','cliente','licenca_pp1',120000,36000,'2025-12-05','2026-05-30','2026-05-19',null),
('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000005','22222222-2222-2222-2222-222222222222','Cockpit de produção','contactado','consultoria',34000,null,'2026-08-11','2026-12-15',null,null),
('30000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000006','22222222-2222-2222-2222-222222222222','Previsão de qualidade','reuniao_marcada','piloto',56000,null,'2026-07-24','2027-01-20',null,null),
('30000000-0000-0000-0000-000000000007','10000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000007','33333333-3333-3333-3333-333333333333','Rastreabilidade operacional','nao_contactado','consultoria',28000,null,null,'2027-02-15',null,null),
('30000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000008','11111111-1111-1111-1111-111111111111','APS para máquinas especiais','proposta','misto',76000,null,'2026-03-04','2026-10-31',null,null),
('30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000009','20000000-0000-0000-0000-000000000009','11111111-1111-1111-1111-111111111111','Delivery risk europeu','piloto','licenca_pp1',145000,42000,'2025-11-20','2026-09-15',null,null),
('30000000-0000-0000-0000-000000000010','10000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000010','22222222-2222-2222-2222-222222222222','Modelo de capacidade','contactado','consultoria',41000,null,'2026-08-02','2027-01-15',null,null),
('30000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000011','33333333-3333-3333-3333-333333333333','PP1 licença anual','cliente','licenca_pp1',88000,28000,'2025-10-08','2026-03-31','2026-03-11',null),
('30000000-0000-0000-0000-000000000012','10000000-0000-0000-0000-000000000012','20000000-0000-0000-0000-000000000012','33333333-3333-3333-3333-333333333333','Monitor de atrasos','reuniao_feita','piloto',64000,null,'2026-05-14','2026-12-20',null,null)
on conflict (id) do nothing;

-- Reconstitui histórico temporal determinístico para validar as views de métricas.
delete from public.estado_historico where oportunidade_id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, null, 'nao_contactado', coalesce(o.data_primeiro_contacto::timestamptz - interval '7 days', o.created_at), o.owner_id from public.oportunidades o where o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'nao_contactado', 'contactado', o.data_primeiro_contacto::timestamptz, o.owner_id from public.oportunidades o where o.data_primeiro_contacto is not null and o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'contactado', 'reuniao_marcada', o.data_primeiro_contacto::timestamptz + interval '18 days', o.owner_id from public.oportunidades o where o.estado in ('reuniao_marcada','reuniao_feita','proposta','piloto','cliente') and o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'reuniao_marcada', 'reuniao_feita', o.data_primeiro_contacto::timestamptz + interval '27 days', o.owner_id from public.oportunidades o where o.estado in ('reuniao_feita','proposta','piloto','cliente') and o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'reuniao_feita', 'proposta', o.data_primeiro_contacto::timestamptz + interval '54 days', o.owner_id from public.oportunidades o where o.estado in ('proposta','piloto','cliente') and o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'proposta', 'piloto', o.data_primeiro_contacto::timestamptz + interval '82 days', o.owner_id from public.oportunidades o where o.estado in ('piloto','cliente') and o.id::text like '30000000-0000-0000-0000-%';
insert into public.estado_historico(oportunidade_id,estado_anterior,estado_novo,changed_at,changed_by)
select o.id, 'piloto', 'cliente', o.data_fecho::timestamptz, o.owner_id from public.oportunidades o where o.estado = 'cliente' and o.id::text like '30000000-0000-0000-0000-%';

insert into public.faturacao(empresa_id,oportunidade_id,tipo,valor,data,descricao,recorrente,referencia_externa) values
('10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','contratualizado',120000,'2026-05-19','Contrato plataforma de dados',true,'CON-2026-014'),
('10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','faturado',46000,'2026-06-01','Fase 1 e setup','false','FT 2026/071'),
('10000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000004','recebido',46000,'2026-07-03','Recebimento fase 1','false','FT 2026/071'),
('10000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000011','contratualizado',88000,'2026-03-11','Licença PP1 anual',true,'CON-2026-006'),
('10000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000011','faturado',58000,'2026-04-02','Setup e licença','false','FT 2026/044'),
('10000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000011','recebido',58000,'2026-05-05','Recebimento setup e licença','false','FT 2026/044');

insert into public.objetivos(ano,mes,tipo,valor_alvo,user_id) values
(2026,null,'faturacao',480000,null),(2026,8,'faturacao',40000,null),(2026,8,'reunioes',10,null),(2026,8,'propostas',5,null);
