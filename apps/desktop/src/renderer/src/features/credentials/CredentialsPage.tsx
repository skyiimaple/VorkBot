import type { ModelCredential } from "@vork/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useVorkApi } from "@/features/chat/useConversation";
import { ManagePage } from "@/routes/ManagePages";

const credentialsKeys = {
  all: ["credentials"] as const
};

type CredentialFormState = {
  provider: "openai-compatible";
  baseUrl: string;
  model: string;
  apiKey: string;
};

const emptyForm = (): CredentialFormState => ({
  provider: "openai-compatible",
  baseUrl: "",
  model: "",
  apiKey: ""
});

export function CredentialsPage() {
  const api = useVorkApi();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModelCredential | null>(null);
  const [form, setForm] = useState<CredentialFormState>(emptyForm());
  const [formError, setFormError] = useState<string>();

  const credentialsQuery = useQuery({
    queryKey: credentialsKeys.all,
    queryFn: async () => {
      const response = await api.request({ operation: "listCredentials", input: {} });
      if (response.operation !== "listCredentials") throw new Error("Unexpected listCredentials response");
      return response.data;
    }
  });

  const upsertMutation = useMutation({
    mutationFn: async (input: CredentialFormState) => {
      const response = await api.request({
        operation: "upsertCredential",
        input: {
          provider: input.provider,
          apiKey: input.apiKey.trim(),
          ...(input.baseUrl.trim() ? { baseUrl: input.baseUrl.trim() } : {}),
          ...(input.model.trim() ? { model: input.model.trim() } : {})
        }
      });
      if (response.operation !== "upsertCredential") throw new Error("Unexpected upsertCredential response");
      return response.data;
    },
    onSuccess: async (data) => {
      queryClient.setQueryData(credentialsKeys.all, data);
      setDialogOpen(false);
      setEditing(null);
      setForm(emptyForm());
      setFormError(undefined);
    },
    onError: () => setFormError("保存失败，请检查填写内容后重试。")
  });

  const deleteMutation = useMutation({
    mutationFn: async (provider: "openai-compatible") => {
      const response = await api.request({
        operation: "deleteCredential",
        input: { provider }
      });
      if (response.operation !== "deleteCredential") throw new Error("Unexpected deleteCredential response");
      return response.data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(credentialsKeys.all, data);
    }
  });

  const data = credentialsQuery.data;
  const remoteCredentials = (data?.credentials ?? []).filter((item) => item.mode === "remote");
  const builtinCredentials = (data?.credentials ?? []).filter((item) => item.mode !== "remote");

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormError(undefined);
    setDialogOpen(true);
  }

  function openEdit(credential: ModelCredential) {
    setEditing(credential);
    setForm({
      provider: "openai-compatible",
      baseUrl: credential.baseUrl ?? "",
      model: credential.model ?? "",
      apiKey: ""
    });
    setFormError(undefined);
    setDialogOpen(true);
  }

  function submitForm() {
    if (!form.apiKey.trim()) {
      setFormError("请填写 API Key。");
      return;
    }
    if (form.baseUrl.trim()) {
      try {
        new URL(form.baseUrl.trim());
      } catch {
        setFormError("Base URL 格式不正确。");
        return;
      }
    }
    setFormError(undefined);
    upsertMutation.mutate(form);
  }

  return (
    <ManagePage title="模型凭据" description="配置模型供应商与密钥；密钥只写不读，列表仅展示掩码。" path="/credentials">
      <div className="space-y-3">
        <div className="rounded-2xl border bg-card p-4 shadow-panel">
          <p className="text-[13px] font-medium">{data?.currentMode.label ?? "当前模式"}</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {credentialsQuery.isLoading
              ? "正在加载凭据…"
              : (data?.currentMode.description ?? "使用确定性 FakeModel，无需密钥。")}
          </p>
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">已保存凭据</p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-lg text-[12px]"
            onClick={() => {
              if (remoteCredentials[0]) openEdit(remoteCredentials[0]);
              else openCreate();
            }}
          >
            <Plus className="size-3.5" />
            {remoteCredentials.length > 0 ? "编辑凭据" : "添加凭据"}
          </Button>
        </div>

        {remoteCredentials.length === 0 && builtinCredentials.length === 0 ? (
          <div className="rounded-2xl border border-dashed bg-card/60 px-5 py-10 text-center">
            <p className="text-[13px] text-muted-foreground">尚未配置凭据。</p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-2xl border bg-card shadow-panel">
            {[...remoteCredentials, ...builtinCredentials].map((credential, index) => (
              <li key={credential.id}>
                {index > 0 && <Separator />}
                <div className="flex w-full items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{credential.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                      {credential.summary}
                    </span>
                  </span>
                  <Badge
                    variant={credential.mode === "remote" ? "default" : "secondary"}
                    className="h-5 shrink-0 px-1.5 text-[10px] font-normal"
                  >
                    {credential.statusLabel}
                  </Badge>
                  {credential.mode === "remote" && (
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg p-0"
                        aria-label="编辑凭据"
                        onClick={() => openEdit(credential)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 rounded-lg p-0 text-destructive"
                        aria-label="删除凭据"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (credential.provider === "openai-compatible") {
                            deleteMutation.mutate("openai-compatible");
                          }
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? "编辑模型凭据" : "添加模型凭据"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <Field label="供应商">
              <Input value="openai-compatible" disabled className="h-9 rounded-lg" />
            </Field>
            <Field label="Base URL">
              <Input
                value={form.baseUrl}
                onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))}
                placeholder="https://api.deepseek.com"
                className="h-9 rounded-lg"
              />
            </Field>
            <Field label="模型">
              <Input
                value={form.model}
                onChange={(event) => setForm((current) => ({ ...current, model: event.target.value }))}
                placeholder="deepseek-v4-flash"
                className="h-9 rounded-lg"
              />
            </Field>
            <Field label="API Key">
              <Input
                type="password"
                value={form.apiKey}
                onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))}
                placeholder={editing ? "重新输入密钥以保存" : "sk-…"}
                className="h-9 rounded-lg"
                autoComplete="off"
              />
            </Field>
            {formError && <p className="text-[12px] text-destructive">{formError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" className="rounded-lg" onClick={() => setDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              className="rounded-lg"
              disabled={upsertMutation.isPending}
              onClick={submitForm}
            >
              {upsertMutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ManagePage>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[12px] font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
