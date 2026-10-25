{{- define "maxwell.name" -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}

{{- define "maxwell.labels" -}}
app.kubernetes.io/name: maxwell
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "maxwell.selector" -}}
app.kubernetes.io/name: maxwell
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "maxwell.secretName" -}}
{{- default (printf "%s-secrets" (include "maxwell.name" .)) .Values.existingSecret -}}
{{- end -}}

{{- define "maxwell.configName" -}}
{{- printf "%s-config" (include "maxwell.name" .) -}}
{{- end -}}

{{- define "maxwell.postgresHost" -}}
{{- printf "%s-postgres" (include "maxwell.name" .) -}}
{{- end -}}

{{- define "maxwell.dashboardUrl" -}}
{{- if .Values.dashboard.host -}}
{{- printf "%s://%s" (ternary "https" "http" .Values.ingress.tls.enabled) .Values.dashboard.host -}}
{{- end -}}
{{- end -}}

{{- define "maxwell.image" -}}
{{- printf "%s:%s" .image.repository (required "image tag is required, pass --set bot.image.tag and dashboard.image.tag" .image.tag) -}}
{{- end -}}

{{- define "maxwell.databaseEnv" -}}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "maxwell.secretName" . }}
      key: POSTGRES_PASSWORD
{{- if .Values.postgres.enabled }}
- name: DATABASE_URL
  value: {{ printf "postgres://%s:$(POSTGRES_PASSWORD)@%s:5432/%s" .Values.postgres.user (include "maxwell.postgresHost" .) .Values.postgres.database | quote }}
{{- else }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "maxwell.secretName" . }}
      key: DATABASE_URL
{{- end }}
{{- end -}}

{{- define "maxwell.secretEnv" -}}
{{- $name := include "maxwell.secretName" . -}}
{{- range $key := list "FLUXER_TOKEN" "FLUXER_CLIENT_ID" "FLUXER_CLIENT_SECRET" "SESSION_SECRET" "FLUXERLIST_API_KEY" "TWITCH_CLIENT_SECRET" }}
- name: {{ $key }}
  valueFrom:
    secretKeyRef:
      name: {{ $name }}
      key: {{ $key }}
      optional: true
{{- end }}
{{- end -}}
